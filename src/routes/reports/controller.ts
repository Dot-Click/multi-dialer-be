import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { RequestHandler } from "express";
import { getNumberReputation } from "@/services/twilio-lookup";

/**
 * Get agent specific report
 * Includes: Dialing time, Calls Made, Leads (total), Calls/hr, Contacts/hr, Calls/lead
 */
export const getAgentReport: RequestHandler = async (req, res) => {
    try {
        const requesterId = req.user?.id;
        const requesterRole = req.user?.role;

        console.log("req.user", req.user)

        if (!requesterId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const { startDate, endDate, userId: queryUserId } = req.query;

        // Default to requester's ID
        let userId = requesterId;

        // If ADMIN or OWNER, they can request report for a specific agent via query param
        if ((requesterRole === "ADMIN" || requesterRole === "OWNER") && queryUserId) {
            userId = queryUserId as string;
        }

        const dateFilter: any = {};
        if (startDate || endDate) {
            dateFilter.createdAt = {};
            if (startDate) dateFilter.createdAt.gte = new Date(startDate as string);
            if (endDate) dateFilter.createdAt.lte = new Date(endDate as string);
        }

        // 1. Dialing Time (Total duration of calls in the period)
        const calls = await prisma.callRecord.aggregate({
            where: {
                userId,
                ...(startDate ? { startTime: { gte: new Date(startDate as string) } } : {}),
                ...(endDate ? { startTime: { lte: new Date(endDate as string) } } : {}),
            },
            _sum: { duration: true }
        });
        const totalDialingSeconds = calls._sum.duration || 0;

        // 2. Calls Made
        const callsMade = await prisma.callRecord.count({
            where: {
                userId,
                ...dateFilter
            }
        });

        // 3. Leads (total assigned to agent)
        const totalLeads = await prisma.lead.count({
            where: { userId }
        });

        // 4. Contacts (Calls that resulted in analysis - implying a conversation happened)
        // Since CallAnalysis doesn't have a direct relation in schema, we'll use a subquery approach
        // but for better performance we filter CallAnalysis by date if provided
        const analysisWhere: any = {};
        if (startDate || endDate) {
            analysisWhere.createdAt = {};
            if (startDate) analysisWhere.createdAt.gte = new Date(startDate as string);
            if (endDate) analysisWhere.createdAt.lte = new Date(endDate as string);
        }

        const analyzedCalls = await prisma.callAnalysis.findMany({
            where: analysisWhere,
            select: { callSid: true }
        });
        const analyzedCallSids = analyzedCalls.map(a => a.callSid);

        const contacts = await prisma.callRecord.count({
            where: {
                userId,
                ...dateFilter,
                callSid: { in: analyzedCallSids }
            }
        });

        // Appointments Set
        const appointmentsSet = await prisma.calendar.count({
            where: {
                assignToId: userId,
                ...(startDate || endDate ? {
                    startDate: {
                        ...(startDate ? { gte: new Date(startDate as string) } : {}),
                        ...(endDate ? { lte: new Date(endDate as string) } : {})
                    }
                } : {})
            }
        });

        // Appointments Met
        const appointmentsMet = await prisma.calendar.count({
            where: {
                assignToId: userId,
                status: "MET",
                ...(startDate || endDate ? {
                    startDate: {
                        ...(startDate ? { gte: new Date(startDate as string) } : {}),
                        ...(endDate ? { lte: new Date(endDate as string) } : {})
                    }
                } : {})
            }
        });

        // 5. Calls/hr
        const hours = totalDialingSeconds / 3600;
        const callsPerHour = hours > 0 ? (callsMade / hours).toFixed(2) : "0.00";

        // 6. Contacts/hr
        const contactsPerHour = hours > 0 ? (contacts / hours).toFixed(2) : "0.00";

        // 7. Calls/lead
        const callsPerLead = totalLeads > 0 ? (callsMade / totalLeads).toFixed(2) : "0.00";

        // 8. Contacts/lead
        const contactsPerLead = totalLeads > 0 ? (contacts / totalLeads).toFixed(2) : "0.00";

        // 9. Time/Appointment
        const timePerAppointmentSeconds = appointmentsSet > 0 ? Math.floor(totalDialingSeconds / appointmentsSet) : 0;
        const timePerAppointment = formatDuration(timePerAppointmentSeconds);

        // 10. Calls/Appointment
        const callsPerAppointment = appointmentsSet > 0 ? (callsMade / appointmentsSet).toFixed(2) : "0.00";

        // 11. Contacts/Appointment
        const contactsPerAppointment = appointmentsSet > 0 ? (contacts / appointmentsSet).toFixed(2) : "0.00";

        const report = {
            dialingTime: formatDuration(totalDialingSeconds),
            dialingSeconds: totalDialingSeconds,
            callsMade,
            totalLeads,
            contacts,
            callsPerHour,
            contactsPerHour,
            callsPerLead,
            contactsPerLead,
            appointmentsSet,
            appointmentsMet,
            timePerAppointment,
            callsPerAppointment,
            contactsPerAppointment,
            period: {
                start: startDate || "All time",
                end: endDate || "Present"
            }
        };

        successResponse(res, 200, "Agent report generated successfully", report);
    } catch (error: any) {
        console.error("Error generating agent report:", error);
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get dialer health based on call analysis confidence
 * Healthy: confidence >= 0.7
 * Unhealthy: confidence < 0.7
 */
export const getDialerHealth: RequestHandler = async (req, res) => {
    try {
        const { id: userId, role } = req.user!;
        let targetUserIds = [userId];

        if (role === 'ADMIN' || role === 'OWNER') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            targetUserIds = [userId, ...agents.map(a => a.id)];
        }

        // 1. Fetch Reputation-based health from Caller IDs
        // We only show unique Twilio numbers that have a SID (official status)
        const callerIds = await prisma.callerId.findMany({
            where: { 
                systemSetting: { userId: { in: targetUserIds } },
                twillioSid: { not: null },
                twillioNumber: { not: null }
            },
            orderBy: { createdAt: 'desc' }
        });

        // De-duplicate by twillioNumber to ensure each number only appears once
        const seenNumbers = new Set();
        const healthData = callerIds.filter(cid => {
            if (seenNumbers.has(cid.twillioNumber)) return false;
            seenNumbers.add(cid.twillioNumber);
            return true;
        }).map(cid => ({
            id: cid.id,
            name: cid.label,
            contact: cid.twillioNumber || "No Number",
            health: cid.reputationStatus === "flagged" ? "unhealthy" : "healthy",
            reputation: cid.reputationStatus,
            score: cid.reputationScore,
            type: "reputation"
        }));

        successResponse(res, 200, "Dialer health fetched successfully", healthData);
    } catch (error: any) {
        console.error("Error fetching dialer health:", error);
        errorResponse(res, { message: error.message });
    }
}

/**
 * Get sales agents performance for admin dashboard
 */
export const getSalesAgentsPerformance: RequestHandler = async (req, res) => {
    try {
        const { id: requesterId, role: requesterRole } = req.user!;

        if (requesterRole !== 'ADMIN' && requesterRole !== 'OWNER') {
            errorResponse(res, { message: "Only admins or owners can access this report" }, 403);
            return;
        }

        const agents = await prisma.user.findMany({
            where: { createdById: requesterId },
            select: { id: true, fullName: true }
        });

        const agentIds = agents.map(a => a.id);
        const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const totalCallsGrouped = await prisma.callRecord.groupBy({
            by: ['userId'],
            where: {
                userId: { in: agentIds },
                startTime: { gte: last30Days }
            },
            _count: { _all: true }
        });

        const analyses = await prisma.callAnalysis.findMany({
            where: { createdAt: { gte: last30Days } },
            select: { callSid: true }
        });
        const analyzedCallSids = analyses.map(a => a.callSid);

        const connectedCallsGrouped = await prisma.callRecord.groupBy({
            by: ['userId'],
            where: {
                userId: { in: agentIds },
                startTime: { gte: last30Days },
                callSid: { in: analyzedCallSids }
            },
            _count: { _all: true }
        });

        const performanceMap = new Map();
        totalCallsGrouped.forEach(item => {
            performanceMap.set(item.userId, {
                totalCalls: item._count._all,
                connectedCalls: 0
            });
        });

        connectedCallsGrouped.forEach(item => {
            const current = performanceMap.get(item.userId) || { totalCalls: 0, connectedCalls: 0 };
            performanceMap.set(item.userId, {
                ...current,
                connectedCalls: item._count._all
            });
        });

        const performanceData = agents.map(agent => {
            const stats = performanceMap.get(agent.id) || { totalCalls: 0, connectedCalls: 0 };
            const conversionRate = stats.totalCalls > 0
                ? Math.round((stats.connectedCalls / stats.totalCalls) * 100)
                : 0;

            return {
                name: agent.fullName || "Unknown",
                totalCalls: stats.totalCalls,
                connectedCalls: stats.connectedCalls,
                conversionRate: `${conversionRate}%`
            };
        }).sort((a, b) => b.totalCalls - a.totalCalls);

        successResponse(res, 200, "Sales agents performance fetched", performanceData);
    } catch (error: any) {
        console.error("Error fetching sales agents performance:", error);
        errorResponse(res, { message: error.message });
    }
}

/**
 * Get agent call metrics for admin dashboard
 */
export const getAgentCallMetrics: RequestHandler = async (req, res) => {
    try {
        const { id: requesterId, role: requesterRole } = req.user!;

        if (requesterRole !== 'ADMIN' && requesterRole !== 'OWNER') {
            errorResponse(res, { message: "Only admins or owners can access this report" }, 403);
            return;
        }

        const agents = await prisma.user.findMany({
            where: { createdById: requesterId },
            select: { id: true, fullName: true }
        });

        const agentIds = agents.map(a => a.id);
        const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const avgDurationGrouped = await prisma.callRecord.groupBy({
            by: ['userId'],
            where: {
                userId: { in: agentIds },
                startTime: { gte: last30Days },
                duration: { not: null }
            },
            _avg: { duration: true }
        });

        const callsByStatus = await prisma.callRecord.groupBy({
            by: ['userId', 'status'],
            where: {
                userId: { in: agentIds },
                startTime: { gte: last30Days },
                status: { in: ['completed', 'no-answer', 'busy'] }
            },
            _count: { _all: true }
        });

        const analyses = await prisma.callAnalysis.findMany({
            where: { createdAt: { gte: last30Days } },
            select: { callSid: true, sentiment: true }
        });

        const positiveSids = analyses.filter(a => a.sentiment === 'POSITIVE').map(a => a.callSid);
        const analysedSids = analyses.map(a => a.callSid);

        const positiveGrouped = await prisma.callRecord.groupBy({
            by: ['userId'],
            where: {
                userId: { in: agentIds },
                startTime: { gte: last30Days },
                callSid: { in: positiveSids }
            },
            _count: { _all: true }
        });

        const analysedTotalGrouped = await prisma.callRecord.groupBy({
            by: ['userId'],
            where: {
                userId: { in: agentIds },
                startTime: { gte: last30Days },
                callSid: { in: analysedSids }
            },
            _count: { _all: true }
        });

        const metricsMap = new Map();

        avgDurationGrouped.forEach(item => {
            metricsMap.set(item.userId, {
                avgTime: Math.round(item._avg.duration || 0),
                completed: 0,
                nosy: 0,
                positive: 0,
                analysed: 0
            });
        });

        callsByStatus.forEach(item => {
            const current = metricsMap.get(item.userId) || { avgTime: 0, completed: 0, nosy: 0, positive: 0, analysed: 0 };
            if (item.status === 'completed') {
                current.completed = item._count._all;
            } else {
                current.nosy += item._count._all;
            }
            metricsMap.set(item.userId, current);
        });

        positiveGrouped.forEach(item => {
            const current = metricsMap.get(item.userId) || { avgTime: 0, completed: 0, nosy: 0, positive: 0, analysed: 0 };
            current.positive = item._count._all;
            metricsMap.set(item.userId, current);
        });

        analysedTotalGrouped.forEach(item => {
            const current = metricsMap.get(item.userId) || { avgTime: 0, completed: 0, nosy: 0, positive: 0, analysed: 0 };
            current.analysed = item._count._all;
            metricsMap.set(item.userId, current);
        });

        const metricsData = agents.map(agent => {
            const stats = metricsMap.get(agent.id) || { avgTime: 0, completed: 0, nosy: 0, positive: 0, analysed: 0 };

            const totalStatus = stats.completed + stats.nosy;
            const objHandling = totalStatus > 0 ? Math.round((stats.completed / totalStatus) * 100) : 0;
            const interestRate = stats.analysed > 0 ? Math.round((stats.positive / stats.analysed) * 100) : 0;

            return {
                name: agent.fullName || "Unknown",
                avgcalltime: formatDuration(stats.avgTime),
                objhandling: `${objHandling}%`,
                interest: `${interestRate}%`,
                avgSeconds: stats.avgTime
            };
        }).sort((a, b) => b.avgSeconds - a.avgSeconds);

        successResponse(res, 200, "Agent call metrics fetched successfully", metricsData);
    } catch (error: any) {
        console.error("Error fetching agent call metrics:", error);
        errorResponse(res, { message: error.message });
    }
}

/**
 * Get call statistics for dashboard (Admin/Agent)
 */
export const getCallStatistics: RequestHandler = async (req, res) => {
    try {
        const { id: requesterId, role: requesterRole } = req.user!;
        const { period, userId: queryUserId } = req.query;

        let targetUserIds: string[] = [requesterId];

        if (requesterRole === 'ADMIN' || requesterRole === 'OWNER') {
            if (queryUserId) {
                targetUserIds = [queryUserId as string];
            } else {
                const agents = await prisma.user.findMany({
                    where: { createdById: requesterId },
                    select: { id: true }
                });
                targetUserIds = [requesterId, ...agents.map(a => a.id)];
            }
        }

        let startDate = new Date();
        if (period === 'Last 7 days') {
            startDate.setDate(startDate.getDate() - 7);
        } else if (period === 'Last 30 days') {
            startDate.setDate(startDate.getDate() - 30);
        } else {
            // "Today"
            startDate.setHours(0, 0, 0, 0);
        }

        const totalCalls = await prisma.callRecord.count({
            where: {
                userId: { in: targetUserIds },
                startTime: { gte: startDate }
            }
        });

        const analyses = await prisma.callAnalysis.findMany({
            where: { createdAt: { gte: startDate } },
            select: { callSid: true }
        });
        const analyzedCallSids = analyses.map(a => a.callSid);

        const connectedCallsCount = await prisma.callRecord.count({
            where: {
                userId: { in: targetUserIds },
                startTime: { gte: startDate },
                callSid: { in: analyzedCallSids }
            }
        });

        const connectionRate = totalCalls > 0 ? Math.round((connectedCallsCount / totalCalls) * 100) : 0;

        const outcomes = await prisma.callRecord.groupBy({
            by: ['disposition'],
            where: {
                userId: { in: targetUserIds },
                startTime: { gte: startDate }
            },
            _count: { _all: true }
        });

        const targetCallSids = await prisma.callRecord.findMany({
            where: {
                userId: { in: targetUserIds },
                startTime: { gte: startDate }
            },
            select: { callSid: true }
        });
        const callSids = targetCallSids.map(c => c.callSid);

        const interestedCount = await prisma.callAnalysis.count({
            where: {
                callSid: { in: callSids },
                confidence: { gte: 0.7 }
            }
        });

        const outcomeCounts = {
            interested: interestedCount,
            followup: 0,
            noAnswer: 0,
            notInterested: 0,
            dnc: 0
        };

        outcomes.forEach(o => {
            const status = o.disposition;
            const count = o._count._all;
            if (status === 'CALL_BACK') outcomeCounts.followup += count;
            else if (status === 'NO_ANSWER') outcomeCounts.noAnswer += count;
            else if (status === 'NOT_INTERESTED') outcomeCounts.notInterested += count;
            else if (status === 'DO_NOT_CALL') outcomeCounts.dnc += count;
        });

        const data = {
            totalCalls,
            connectionRate: `${connectionRate}%`,
            outcomes: outcomeCounts,
            goals: {
                followup: { current: outcomeCounts.followup, target: 10 },
                interested: { current: outcomeCounts.interested, target: 5 }
            }
        };

        successResponse(res, 200, "Call statistics fetched successfully", data);
    } catch (error: any) {
        console.error("Error fetching call statistics:", error);
        errorResponse(res, { message: error.message });
    }
}

/**
 * Helper to format seconds into readable string
 */
function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/**
 * Manually refresh Caller ID reputation status using Twilio Lookup
 */
export const refreshDialerHealth: RequestHandler = async (req, res) => {
    try {
        const { id: userId, role } = req.user!;
        let targetUserIds = [userId];

        if (role === 'ADMIN' || role === 'OWNER') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            targetUserIds = [userId, ...agents.map(a => a.id)];
        }

        const callerIds = await prisma.callerId.findMany({
            where: { systemSetting: { userId: { in: targetUserIds } } }
        });

        let updatedCount = 0;
        for (const cid of callerIds) {
            if (cid.twillioNumber) {
                const result = await getNumberReputation(cid.twillioNumber);
                if (result) {
                    await prisma.callerId.update({
                        where: { id: cid.id },
                        data: {
                            reputationStatus: result.status,
                            reputationScore: result.score,
                            lastReputationCheck: new Date()
                        }
                    });
                    updatedCount++;
                }
            }
        }

        successResponse(res, 200, `Refreshed reputation for ${updatedCount} numbers`);
    } catch (error: any) {
        console.error("Error refreshing dialer health:", error);
        errorResponse(res, { message: error.message });
    }
}
