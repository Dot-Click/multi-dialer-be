import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { RequestHandler } from "express";

/**
 * Get virtual session report (aggregated by day from CallRecord)
 * Includes: date, type, list, calls, appointments, duration
 */
export const getSessionReport: RequestHandler = async (req, res) => {
    try {
        const requesterId = req.user?.id;
        const requesterRole = req.user?.role;

        if (!requesterId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const { startDate, endDate, userId: queryUserId, page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        // Determine target userId
        let userId = requesterId;
        if ((requesterRole === "ADMIN" || requesterRole === "OWNER") && queryUserId) {
            userId = queryUserId as string;
        }

        const where: any = { userId };
        if (startDate || endDate) {
            where.startTime = {};
            if (startDate) where.startTime.gte = new Date(startDate as string);
            if (endDate) where.startTime.lte = new Date(endDate as string);
        }

        // Fetch user info
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { fullName: true }
        });

        const agentName = user?.fullName || "Unknown Agent";

        // Fetch all relevant calls for aggregation
        const calls = await prisma.callRecord.findMany({
            where,
            include: {
                session: true
            },
            orderBy: { startTime: "desc" }
        });

        // Optimize list name fetching
        const listIds = Array.from(new Set(calls.map(c => c.session?.listId).filter(Boolean))) as string[];
        const lists = await prisma.contactList.findMany({
            where: { id: { in: listIds } },
            select: { id: true, name: true }
        });
        const listMap = new Map(lists.map(l => [l.id, l.name]));

        // Group calls into "Virtual Daily Sessions"
        // Key: YYYY-MM-DD
        const sessionMap = new Map<string, any>();

        calls.forEach(call => {
            if (!call.startTime) return;
            const dateStr = new Date(call.startTime).toISOString().split('T')[0];

            if (!sessionMap.has(dateStr)) {
                sessionMap.set(dateStr, {
                    id: `session-${dateStr}-${userId}`,
                    date: dateStr,
                    agent: agentName,
                    type: "C2C Session", // Standardized to C2C Session as expected
                    listIds: new Set<string>(),
                    calls: [],
                    duration: 0
                });
            }

            const session = sessionMap.get(dateStr);
            if (call.session?.listId) {
                session.listIds.add(call.session.listId);
            }
            session.calls.push(call);
            session.duration += (call.duration || 0);
        });

        const allSessionsRaw = Array.from(sessionMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Manual Pagination
        const paginatedSessions = allSessionsRaw.slice(skip, skip + Number(limit));

        // Process sessions for the final report
        const reportData = await Promise.all(paginatedSessions.map(async (vsession) => {
            // Calculate breakdown by result (disposition)
            const resultBreakdown: Record<string, { totalCalls: number; talkTime: number; dialTime: number }> = {};

            vsession.calls.forEach((call: any) => {
                const result = call.disposition || "CALLED";
                if (!resultBreakdown[result]) {
                    resultBreakdown[result] = { totalCalls: 0, talkTime: 0, dialTime: 0 };
                }
                resultBreakdown[result].totalCalls += 1;
                resultBreakdown[result].talkTime += (call.duration || 0);
            });

            // Convert breakdown to array
            const results = Object.entries(resultBreakdown).map(([result, stats]) => ({
                result,
                totalCalls: stats.totalCalls,
                talkTime: formatHHMMSS(stats.talkTime),
                dialTime: formatHHMMSS(0) // Assuming talk time is all we have accurately
            }));

            // List names
            const listNames = Array.from(vsession.listIds)
                .map(id => listMap.get(id as string) || "Unknown")
                .join(", ") || "N/A";

            // Appointments set during this day
            const dayStart = new Date(vsession.date);
            const dayEnd = new Date(vsession.date);
            dayEnd.setDate(dayEnd.getDate() + 1);

            const appointmentsCount = await prisma.calendar.count({
                where: {
                    assignToId: userId,
                    status: "SET",
                    createdAt: {
                        gte: dayStart,
                        lt: dayEnd
                    }
                }
            });

            return {
                id: vsession.id,
                date: vsession.date,
                agent: vsession.agent,
                type: vsession.type,
                list: listNames,
                calls: vsession.calls.length,
                appointments: appointmentsCount,
                duration: formatHHMMSS(vsession.duration),
                breakdown: {
                    results,
                    total: {
                        calls: vsession.calls.length,
                        talkTime: formatHHMMSS(vsession.duration),
                        dialTime: formatHHMMSS(vsession.duration) // Same as talk right now
                    }
                }
            };
        }));

        successResponse(res, 200, "Session report fetched successfully", {
            data: reportData,
            pagination: {
                total: allSessionsRaw.length,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        console.error("Error generating session report:", error);
        errorResponse(res, { message: error.message });
    }
};

/**
 * Helper to format seconds into HH:MM:SS
 */
function formatHHMMSS(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
        .map(v => v < 10 ? "0" + v : v)
        .join(":");
}
