import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { RequestHandler } from "express";

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
