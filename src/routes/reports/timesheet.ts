import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { RequestHandler } from "express";

/**
 * Get Agent Timesheet report
 * Includes: Date, Agent, Device, Log In Time, Log Out Time, Time Logged
 */
export const getAgentTimesheetReport: RequestHandler = async (req, res) => {
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

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate as string);
            if (endDate) where.createdAt.lte = new Date(endDate as string);
        }

        // Fetch auth sessions
        const sessions = await prisma.session.findMany({
            where,
            include: {
                user: { select: { fullName: true } }
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: Number(limit)
        });

        const total = await prisma.session.count({ where });

        const reportData = sessions.map(session => {
            const logInTime = session.createdAt;
            const logOutTime = session.updatedAt;
            const timeDiffMs = logOutTime.getTime() - logInTime.getTime();
            const timeLoggedSeconds = Math.max(0, Math.floor(timeDiffMs / 1000));

            let device = "Web";
            if (session.userAgent) {
                if (session.userAgent.toLowerCase().includes("mobile")) device = "Mobile";
                else if (session.userAgent.toLowerCase().includes("postman")) device = "API";
            }

            return {
                id: session.id,
                date: pad(logInTime.getDate()) + "/" + pad(logInTime.getMonth() + 1) + "/" + logInTime.getFullYear(),
                agent: session.user?.fullName || "Unknown",
                device,
                logIn: formatDate(logInTime),
                logOut: formatDate(logOutTime),
                timeLogged: formatHHMMSS(timeLoggedSeconds) // HH:MM:SS
            };
        });

        successResponse(res, 200, "Agent timesheet fetched successfully", {
            data: reportData,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        console.error("Error generating agent timesheet:", error);
        errorResponse(res, { message: error.message });
    }
};

function pad(n: number) {
    return n < 10 ? '0' + n : n;
}

function formatDate(date: Date) {
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
