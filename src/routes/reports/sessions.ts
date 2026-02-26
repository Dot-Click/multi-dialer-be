import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { RequestHandler } from "express";

/**
 * Get session report
 * Includes: sessions with their calls, talk time, dial time, results breakdown
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

        // Fetch sessions with nested relations
        const sessions = await prisma.agentSession.findMany({
            where,
            include: {
                user: {
                    select: { fullName: true }
                },
                calls: {
                    include: {
                        lead: true
                    }
                }
            },
            orderBy: { startTime: "desc" },
            skip,
            take: Number(limit)
        });

        const total = await prisma.agentSession.count({ where });

        // Optimize list name fetching
        const listIds = Array.from(new Set(sessions.map(s => s.listId).filter(Boolean))) as string[];
        const lists = await prisma.contactList.findMany({
            where: { id: { in: listIds } },
            select: { id: true, name: true }
        });
        const listMap = new Map(lists.map(l => [l.id, l.name]));

        // Process sessions for the report
        const reportData = await Promise.all(sessions.map(async (session) => {
            // Calculate breakdown by result (disposition)
            const resultBreakdown: Record<string, { totalCalls: number; talkTime: number; dialTime: number }> = {};

            session.calls.forEach(call => {
                const result = call.disposition || "Other";
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
                dialTime: formatHHMMSS(session.duration || 0) // Dial time in the screenshot seems to be session duration
            }));

            // Appointments set during this session (rough estimate based on time)
            const appointmentsCount = await prisma.calendar.count({
                where: {
                    assignToId: session.userId,
                    status: "SET",
                    createdAt: {
                        gte: session.startTime,
                        lte: session.endTime || new Date()
                    }
                }
            });

            return {
                id: session.id,
                date: session.startTime,
                agent: session.user.fullName || "Unknown Agent",
                type: session.type, // e.g., C2C Session
                list: session.listId ? (listMap.get(session.listId) || "Unknown List") : "N/A",
                calls: session.calls.length,
                appointments: appointmentsCount,
                duration: formatHHMMSS(session.duration || 0),
                breakdown: {
                    results,
                    total: {
                        calls: session.calls.length,
                        talkTime: formatHHMMSS(session.calls.reduce((sum, c) => sum + (c.duration || 0), 0)),
                        dialTime: formatHHMMSS(session.duration || 0)
                    }
                }
            };
        }));

        successResponse(res, 200, "Session report fetched successfully", {
            data: reportData,
            pagination: {
                total,
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
