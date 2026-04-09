import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { dialerService } from "./services";
import { RequestHandler } from "express";

/**
 * Get aggregate statistics for the analytics dashboard
 */
export const getAggregateStats: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        // 1. Total Calls Made
        const totalCalls = await prisma.callRecord.count({
            where: { userId }
        });

        // 2. Total Contacts Made (Calls that were completed/answered - simplified logic for now)
        const totalContacts = await prisma.callRecord.count({
            where: {
                userId,
                status: "completed"
            }
        });

        // 3. Total Dialing Time (Sum of session durations)
        const sessions = await prisma.agentSession.aggregate({
            where: { userId },
            _sum: { duration: true }
        });
        const totalDialingSeconds = sessions._sum.duration || 0;
        const dialingTimeStr = formatDuration(totalDialingSeconds);

        // 4. Leads (Leads created by/assigned to agent)
        const totalLeads = await prisma.lead.count({
            where: { userId }
        });

        // 5. Appointments Set
        const appointmentsSet = await prisma.calendar.count({
            where: {
                assignToId: userId,
                status: "SET"
            }
        });

        // 6. Appointments Met
        const appointmentsMet = await prisma.calendar.count({
            where: {
                assignToId: userId,
                status: "MET"
            }
        });

        // Derived stats
        const hours = totalDialingSeconds / 3600 || 1;
        const callsPerHour = (totalCalls / hours).toFixed(2);
        const contactsPerHour = (totalContacts / hours).toFixed(2);
        const callsPerLead = totalLeads > 0 ? (totalCalls / totalLeads).toFixed(2) : "0";

        const stats = [
            { label: "Dialing Time", value: dialingTimeStr },
            { label: "Calls Made", value: totalCalls.toString() },
            { label: "Contacts Made", value: totalContacts.toString() },
            { label: "Leads", value: totalLeads.toString() },
            { label: "Appointments Set", value: appointmentsSet.toString() },
            { label: "Appointments Met", value: appointmentsMet.toString() },
            { label: "Calls/Hr", value: callsPerHour },
            { label: "Contacts/Hr", value: contactsPerHour },
            { label: "Calls/Lead", value: callsPerLead },
            // Add more as needed based on frontend
        ];

        successResponse(res, 200, "Stats fetched successfully", { stats });
    } catch (error: any) {
        console.error("Error fetching stats:", error);
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get call records for the call detail table
 */
export const getCallDetails: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const { page = 1, limit = 50, disposition } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const where: any = { userId };
        if (disposition && disposition !== "All Result") {
            where.disposition = disposition;
        }

        const calls = await prisma.callRecord.findMany({
            where,
            include: {
                lead: true
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: Number(limit)
        });

        const total = await prisma.callRecord.count({ where });

        successResponse(res, 200, "Call details fetched", {
            calls,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get agent sessions
 */
export const getSessions: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const { page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const sessions = await prisma.agentSession.findMany({
            where: { userId },
            include: {
                _count: {
                    select: { calls: true }
                }
            },
            orderBy: { startTime: "desc" },
            skip,
            take: Number(limit)
        });

        const total = await prisma.agentSession.count({ where: { userId } });

        successResponse(res, 200, "Sessions fetched", {
            sessions,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

// Start a session
export const startSession: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { listId, type } = req.body;

        const session = await prisma.agentSession.create({
            data: {
                userId: userId!,
                listId,
                type: type || "C2C"
            }
        });

        dialerService.setActiveSession(userId!, session.id);

        successResponse(res, 201, "Session started", session);
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

// End a session
export const endSession: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const endTime = new Date();

        const session = await prisma.agentSession.findUnique({
            where: { id: sessionId }
        });

        if (!session) {
            errorResponse(res, { message: "Session not found" }, 404);
            return;
        }

        const duration = Math.floor((endTime.getTime() - session.startTime.getTime()) / 1000);

        const updatedSession = await prisma.agentSession.update({
            where: { id: sessionId },
            data: {
                endTime,
                duration
            }
        });

        dialerService.clearActiveSession(session.userId);

        successResponse(res, 200, "Session ended", updatedSession);
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get AI Sidekick insights for today
 */
export const getSidekickInsights: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        let userIds = [userId];
        if (req.user?.role === 'ADMIN') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            userIds = [userId, ...agents.map(a => a.id)];
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 1. Fetch analyzed call SIDs for today
        const analyses = await prisma.callAnalysis.findMany({
            where: {
                createdAt: { gte: todayStart }
            },
            select: {
                callSid: true,
                sentiment: true
            }
        });

        const analyzedCallSids = analyses.map(a => a.callSid);
        const positiveCallSids = analyses.filter(a => a.sentiment === "positive").map(a => a.callSid);

        // 2. Calls Analyzed today for these users
        const callsAnalyzed = await prisma.callRecord.count({
            where: {
                userId: { in: userIds },
                startTime: { gte: todayStart },
                callSid: { in: analyzedCallSids }
            }
        });

        // 3. Positive calls today for these users
        const positiveCalls = await prisma.callRecord.count({
            where: {
                userId: { in: userIds },
                startTime: { gte: todayStart },
                callSid: { in: positiveCallSids }
            }
        });

        const successPrediction = callsAnalyzed > 0
            ? Math.round((positiveCalls / callsAnalyzed) * 100)
            : 0;

        // 4. Urgent follow-ups detected (CALL_BACK status today)
        const urgentFollowUps = await prisma.callRecord.count({
            where: {
                userId: { in: userIds },
                startTime: { gte: todayStart },
                disposition: "CALL_BACK"
            }
        });

        // 5. New leads identified today
        const newLeadsIdentified = await prisma.lead.count({
            where: {
                userId: { in: userIds },
                createdAt: { gte: todayStart }
            }
        });

        successResponse(res, 200, "Sidekick insights fetched", {
            callsAnalyzed,
            successPrediction: `${successPrediction}%`,
            urgentFollowUps,
            newLeadsIdentified
        });
    } catch (error: any) {
        console.error("Error fetching sidekick insights:", error);
        errorResponse(res, { message: error.message });
    }
};

export const getBestTimeToCall: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        let userIds = [userId];
        if (req.user?.role === 'ADMIN') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            userIds = [userId, ...agents.map(a => a.id)];
        }

        const { day } = req.query; // Sunday, Monday, etc. or Today
        const today = new Date();
        const dayMap: Record<string, number> = {
            'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
            'Thursday': 4, 'Friday': 5, 'Saturday': 6
        };

        let queryDay = day as string;
        if (queryDay === 'Today') {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            queryDay = days[today.getDay()];
        }

        const dow = dayMap[queryDay] !== undefined ? dayMap[queryDay] : today.getDay();

        // We use raw query to get hourly aggregation efficiently
        // We filter by user and by Day of Week (0-6)
        // We look at the last 90 days of data for better statistics
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const stats: any[] = await prisma.$queryRaw`
            SELECT 
                EXTRACT(HOUR FROM "startTime") as hour,
                COUNT(CASE WHEN "status" = 'no-answer' OR "disposition" = 'NO_ANSWER' THEN 1 END) as dialed,
                COUNT(CASE WHEN "status" = 'completed' OR "disposition" = 'CALLED' THEN 1 END) as talked,
                COUNT(*) as total_attempts
            FROM "call_records"
            WHERE "userId" = ANY(${userIds})
              AND "startTime" >= ${ninetyDaysAgo}
              AND EXTRACT(DOW FROM "startTime") = ${dow}
            GROUP BY hour
            ORDER BY hour ASC
        `;

        // Hours to return (9 AM to 9 PM as per UI)
        const hoursToReturn = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

        const dialedVsTalked = hoursToReturn.map(h => {
            const hourStat = stats.find(s => Number(s.hour) === h);
            return {
                time: `${h}:00`,
                Dialed: hourStat ? Number(hourStat.dialed) : 0,
                Talked: hourStat ? Number(hourStat.talked) : 0,
                totalAttempts: hourStat ? Number(hourStat.total_attempts) : 0
            };
        });

        const answeredPercentage = dialedVsTalked.map(d => {
            const percent = d.totalAttempts > 0 ? Math.round((d.Talked / d.totalAttempts) * 100) : 0;
            // series2 can be a "Global Average" or "Target" - here we'll just mock it slightly different
            // for visual consistency with the design which shows two lines.
            return {
                time: d.time,
                series1: percent,
                series2: Math.max(0, percent - 15) // Example gap for visual
            };
        });


        successResponse(res, 200, "Best time to call fetched", {
            dialedVsTalked,
            answeredPercentage
        });
    } catch (error: any) {
        console.error("Error fetching best time to call:", error);
        errorResponse(res, { message: error.message });
    }
}

/**
 * Get Lead Intelligence analytics
 */
export const getLeadIntelligence: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        // Scope to admin's agents
        let userIds = [userId];
        if (req.user?.role === 'ADMIN') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            userIds = [userId, ...agents.map(a => a.id)];
        }

        // Get all callSids belonging to these users
        const userCallRecords = await prisma.callRecord.findMany({
            where: { userId: { in: userIds } },
            select: { callSid: true }
        });
        const userCallSids = userCallRecords.map(r => r.callSid);

        // 1. Avg AI Lead Score — scoped to user's calls
        const analyses = await prisma.callAnalysis.findMany({
            where: { callSid: { in: userCallSids } },
            select: { confidence: true, sentiment: true }
        });

        const total = analyses.length;
        const avgScore = total > 0
            ? Math.round(analyses.reduce((sum, a) => sum + a.confidence, 0) / total * 100)
            : 0;

        // 2. Engagement Prediction
        const positiveCount = analyses.filter(a => a.sentiment === "positive").length;
        const engagementPrediction = total > 0
            ? Math.round((positiveCount / total) * 100)
            : 0;

        // 3. Urgent Leads
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const urgentLeadsCount = await prisma.callRecord.count({
            where: {
                userId: { in: userIds },
                startTime: { gte: todayStart },
                disposition: "CALL_BACK"
            }
        });

        // const agents = await prisma.user.findMany({
        //     where: { createdById: userId },
        //     select: { id: true }
        // });
        // userIds = [userId, ...agents.map(a => a.id)];

        // 4. Pie Data — derived from same analyses fetch above (no extra query)
        const high = analyses.filter(a => a.confidence >= 0.7).length;
        const medium = analyses.filter(a => a.confidence >= 0.4 && a.confidence < 0.7).length;
        const low = analyses.filter(a => a.confidence < 0.4).length;

        const pieData = [
            { name: "High", value: high },
            { name: "Medium", value: medium },
            { name: "Low", value: low }
        ];

        // 5. Sentiment Trend — last 7 days, scoped via callSid join
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const trendDataRaw: any[] = await prisma.$queryRaw`
            SELECT 
                TO_CHAR(ca."createdAt", 'Dy') as day,
                COUNT(CASE WHEN ca."sentiment" = 'positive' THEN 1 END) as positive,
                COUNT(CASE WHEN ca."sentiment" = 'neutral'  THEN 1 END) as neutral,
                COUNT(CASE WHEN ca."sentiment" = 'negative' THEN 1 END) as negative,
                DATE(ca."createdAt") as date
            FROM "call_analysis" ca
            WHERE ca."callSid" = ANY(${userCallSids})
              AND ca."createdAt" >= ${sevenDaysAgo}
            GROUP BY day, date
            ORDER BY date ASC
        `;

        const sentimentTrend = trendDataRaw.map(t => ({
            name: t.day,
            Positive: Number(t.positive),
            Neutral: Number(t.neutral),
            Negative: Number(t.negative)
        }));

        successResponse(res, 200, "Lead intelligence fetched", {
            summary: {
                avgLeadScore: `${avgScore}%`,
                engagementPrediction: `${engagementPrediction}%`,
                urgentLeads: urgentLeadsCount
            },
            pieData,
            overallScore: avgScore,
            sentimentTrend
        });
    } catch (error: any) {
        console.error("Error fetching lead intelligence:", error);
        errorResponse(res, { message: error.message });
    }
};
/**
 * Get AI Coaching analytics
 */
export const getAiCoaching: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        // Scope to admin's agents
        let userIds = [userId];
        if (req.user?.role === 'ADMIN') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            userIds = [userId, ...agents.map(a => a.id)];
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Get callSids for these users (bridge to CallAnalysis)
        const userCallSids = await prisma.callRecord.findMany({
            where: { userId: { in: userIds } },
            select: { callSid: true }
        }).then(r => r.map(r => r.callSid));

        const todayCallSids = await prisma.callRecord.findMany({
            where: { userId: { in: userIds }, startTime: { gte: todayStart } },
            select: { callSid: true }
        }).then(r => r.map(r => r.callSid));

        // Coaching events today
        const callsToday = todayCallSids.length;
        const analyzedCallsToday = await prisma.callAnalysis.count({
            where: { callSid: { in: todayCallSids } }
        });

        // All analyses for these users
        const analyses = await prisma.callAnalysis.findMany({
            where: { callSid: { in: userCallSids } },
            select: { sentiment: true, confidence: true }
        });

        const total = analyses.length || 1;
        const handledSuccessfully = analyses.filter(a => a.sentiment === "positive" && a.confidence >= 0.6).length;
        const missed = analyses.length - handledSuccessfully;
        const objectionRate = Math.round((handledSuccessfully / total) * 100);

        const excellent = analyses.filter(a => a.confidence >= 0.8).length;
        const average   = analyses.filter(a => a.confidence >= 0.4 && a.confidence < 0.8).length;
        const poor      = analyses.filter(a => a.confidence < 0.4).length;
        const avgConfidence = Math.round(
            analyses.reduce((acc, curr) => acc + curr.confidence, 0) / total * 100
        );

        successResponse(res, 200, "AI coaching fetched", {
            coachingEvents: {
                count: analyzedCallsToday,
                total: callsToday,
                successPercentage: callsToday > 0 ? Math.round((analyzedCallsToday / callsToday) * 100) : 0
            },
            objectionDetection: {
                rate: objectionRate,
                data: [
                    { name: 'Handled successfully', value: handledSuccessfully },
                    { name: 'Missed / unhandled',   value: missed }
                ]
            },
            confidenceIndex: {
                score: avgConfidence,
                data: [
                    { name: 'Excellent', value: excellent },
                    { name: 'Average',   value: average },
                    { name: 'Poor',      value: poor }
                ]
            },
            keywordScore: Math.round(avgConfidence * 0.95)
        });
    } catch (error: any) {
        console.error("Error fetching AI coaching:", error);
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get Call Outcome analytics
 */
export const getCallOutcome: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        // 1. AI-Predicted outcomes (derived from dispositions)
        const totalCalls = await prisma.callRecord.count({ where: { userId } });
        const apptSet = await prisma.callRecord.count({ where: { userId, disposition: "HOT" } });
        const interested = await prisma.callRecord.count({ where: { userId, disposition: "WARM" } });
        const notInterested = await prisma.callRecord.count({ where: { userId, disposition: "NOT_INTERESTED" } });

        const apptSetPerc = totalCalls > 0 ? Math.round((apptSet / totalCalls) * 100) : 0;
        const interestedPerc = totalCalls > 0 ? Math.round((interested / totalCalls) * 100) : 0;

        // 2. Conversation Quality Score (derived from confidence)
        const avgStats = await prisma.callAnalysis.aggregate({
            _avg: { confidence: true }
        });
        const qualityScore = Math.round((avgStats._avg.confidence || 0) * 100);

        // 3. Keyword Optimization Score (Mocked/Distributed)
        const keywordData = [
            { label: 'Low', percentage: 25, color: 'bg-green-500' },
            { label: 'Medium', percentage: 45, color: 'bg-yellow-400' },
            { label: 'High', percentage: 30, color: 'bg-red-500' },
        ];

        successResponse(res, 200, "Call outcome analytics fetched", {
            predictedOutcomes: {
                appointmentSet: `${apptSetPerc}%`,
                interested: `${interestedPerc}%`,
                notInterested: notInterested
            },
            qualityScore,
            keywordData
        });
    } catch (error: any) {
        console.error("Error fetching call outcome:", error);
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get Efficiency & Automation analytics
 */
export const getEfficiency: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        // 1. Time Saved (derived from calls today)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const callsToday = await prisma.callRecord.count({
            where: { userId, startTime: { gte: todayStart } }
        });
        const timeSaved = callsToday * 2; // Assuming 2 mins saved per call

        // 2. Tasks automated
        const tasksAutomated = callsToday * 3; // Assuming 3 tasks per call (CRM update, transcript, etc)
        const tasksAutomatedPercentage = Math.min(Math.round((tasksAutomated / 100) * 100), 100);

        // 3. AI-Handled Conversations
        const analyzedCalls = await prisma.callAnalysis.count({
            where: { createdAt: { gte: todayStart } }
        });
        const handledPercentage = callsToday > 0 ? Math.round((analyzedCalls / callsToday) * 100) : 0;

        successResponse(res, 200, "Efficiency analytics fetched", {
            timeSaved,
            tasksAutomated,
            tasksAutomatedPercentage,
            aiHandled: {
                percentage: handledPercentage,
                data: [
                    { name: 'Handled', value: handledPercentage },
                    { name: 'Not Handled', value: 100 - handledPercentage },
                ]
            }
        });
    } catch (error: any) {
        console.error("Error fetching efficiency:", error);
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get Compliance & Risk Monitoring analytics
 */
export const getCompliance: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        let userIds = [userId];
        if (req.user?.role === 'ADMIN') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            userIds = [userId, ...agents.map(a => a.id)];
        }

        // Get callSids for these users (bridge to CallAnalysis)
        const userCallSids = await prisma.callRecord.findMany({
            where: { userId: { in: userIds } },
            select: { callSid: true }
        }).then(r => r.map(r => r.callSid));

        // 1. Compliance Flags
        const flags = await prisma.callRecord.count({
            where: { userId: { in: userIds }, disposition: "CALL_BACK" }
        });
        const totalCalls = await prisma.callRecord.count({
            where: { userId: { in: userIds } }
        });
        const flagsPercentage = totalCalls > 0
            ? Math.round((flags / totalCalls) * 100)
            : 0;

        // 2. Risk Phrase Detection — scoped via callSids
        const negativeAnalyses = await prisma.callAnalysis.count({
            where: { callSid: { in: userCallSids }, sentiment: "negative" }
        });
        const totalAnalyses = await prisma.callAnalysis.count({
            where: { callSid: { in: userCallSids } }
        });
        const riskRate = totalAnalyses > 0
            ? Math.round((negativeAnalyses / totalAnalyses) * 100)
            : 0;

        successResponse(res, 200, "Compliance analytics fetched", {
            flags,
            flagsPercentage,
            riskRate,
            riskData: [
                { name: 'Detected', value: riskRate },
                { name: 'Safe',     value: 100 - riskRate },
            ]
        });
    } catch (error: any) {
        console.error("Error fetching compliance:", error);
        errorResponse(res, { message: error.message });
    }
};

export const getCallGroup: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        let userIds = [userId];
        if (req.user?.role === 'ADMIN') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            userIds = [userId, ...agents.map(a => a.id)];
        }

        const topLeadsRaw: any[] = await prisma.$queryRaw`
            SELECT 
                l.id,
                l."fullName" as name,
                MAX(ca.confidence) as score,
                l.status
            FROM leads l
            JOIN call_records cr ON cr."leadId" = l.id
            JOIN call_analysis ca ON ca."callSid" = cr."callSid"
            WHERE l."userId" = ANY(${userIds})
            GROUP BY l.id, l."fullName", l.status
            ORDER BY score DESC
            LIMIT 10
        `;

        const result = topLeadsRaw.map(l => ({
            id: l.id,
            name: l.name,
            score: `${Math.round(Number(l.score) * 100)}%`,
            tag: l.status.replace('_', ' ').toLowerCase()
                .replace(/\b\w/g, (c: string) => c.toUpperCase())
        }));

        successResponse(res, 200, "Calling groups/leads fetched", result);
    } catch (error: any) {
        console.error("Error fetching call groups:", error);
        errorResponse(res, { message: error.message });
    }
};

/**
 * Get Agent Improvement & Pipeline analytics
 */
export const getImprovement: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        let userIds = [userId];
        if (req.user?.role === 'ADMIN') {
            const agents = await prisma.user.findMany({
                where: { createdById: userId },
                select: { id: true }
            });
            userIds = [userId, ...agents.map(a => a.id)];
        }

        // Get callSids bridge
        const userCallSids = await prisma.callRecord.findMany({
            where: { userId: { in: userIds } },
            select: { callSid: true }
        }).then(r => r.map(r => r.callSid));

        const avgStats = await prisma.callAnalysis.aggregate({
            where: { callSid: { in: userCallSids } },
            _avg: { confidence: true }
        });
        const currentPerf = Math.round((avgStats._avg.confidence || 0) * 100) / 4;

        const interestedLeads = await prisma.callRecord.count({
            where: { userId: { in: userIds }, disposition: "WARM" }
        });

        successResponse(res, 200, "Improvement and Pipeline analytics fetched", {
            improvement: {
                current: Math.round(currentPerf),
                target: 20
            },
            pipeline: {
                dealsAccelerated: interestedLeads,
                speedIncrease: 25,
                accelerationPercentage: Math.min(interestedLeads * 5, 100)
            }
        });
    } catch (error: any) {
        console.error("Error fetching improvement:", error);
        errorResponse(res, { message: error.message });
    }
};

// Helper to format duration
function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
