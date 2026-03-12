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

        // 2. Calls Analyzed today for this user
        const callsAnalyzed = await prisma.callRecord.count({
            where: {
                userId,
                startTime: { gte: todayStart },
                callSid: { in: analyzedCallSids }
            }
        });

        // 3. Positive calls today for this user
        const positiveCalls = await prisma.callRecord.count({
            where: {
                userId,
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
                userId,
                startTime: { gte: todayStart },
                disposition: "CALL_BACK"
            }
        });

        successResponse(res, 200, "Sidekick insights fetched", {
            callsAnalyzed,
            successPrediction: `${successPrediction}%`,
            urgentFollowUps
        });
    } catch (error: any) {
        console.error("Error fetching sidekick insights:", error);
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
