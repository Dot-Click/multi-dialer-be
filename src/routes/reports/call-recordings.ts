import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { getPresignedUrlFromStoredUrl } from "@/utils/r2-uploader";
import { RequestHandler } from "express";

/**
 * Get call recordings report
 * Includes: agent, name, duration, callResult, audio file 
 */
export const getCallRecordingsReport: RequestHandler = async (req, res) => {
    try {
        const requesterId = req.user?.id;
        const requesterRole = req.user?.role;

        if (!requesterId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const { startDate, endDate, userId: queryUserId, page = 1, limit = 50 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        // Determine target userId
        let userId = requesterId;
        if ((requesterRole === "ADMIN" || requesterRole === "OWNER") && queryUserId) {
            userId = queryUserId as string;
        }

        const where: any = { userId };

        // We only want calls that actually have recordings
        where.recordingUrl = { not: null };

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate as string);
            if (endDate) where.createdAt.lte = new Date(endDate as string);
        }

        // Fetch call records with leads, contacts, and agents
        const calls = await prisma.callRecord.findMany({
            where,
            include: {
                lead: true,
                contact: true,
                user: { select: { fullName: true } }
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: Number(limit)
        });

        const total = await prisma.callRecord.count({ where });

        const reportData = await Promise.all(
            calls.map(async call => {
                const entity = call.contact || call.lead;

                return {
                    id: call.id,
                    agent: call.user?.fullName || "Unknown",
                    name: entity?.fullName || "Unknown",
                    duration: formatHHMMSS(call.duration || 0),
                    callResult: call.disposition || call.status,
                    // Stored URL points at R2's private S3 endpoint; sign it so the
                    // browser's <audio> element can fetch it directly.
                    recordingUrl: await getPresignedUrlFromStoredUrl(call.recordingUrl)
                };
            })
        );

        successResponse(res, 200, "Call recordings report fetched successfully", {
            data: reportData,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        console.error("Error generating call recordings report:", error);
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
