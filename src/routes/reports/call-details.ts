import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { RequestHandler } from "express";

/**
 * Get call details report
 * Includes: name, address, list, group, phone number, result
 */
export const getCallDetailsReport: RequestHandler = async (req, res) => {
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

        // Fetch call records with leads, contacts, and sessions
        const calls = await prisma.callRecord.findMany({
            where,
            include: {
                lead: true,
                contact: {
                    include: {
                        phones: true
                    }
                },
                session: true
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: Number(limit)
        });

        const total = await prisma.callRecord.count({ where });

        // Optimize list name fetching
        const listIds = Array.from(new Set(calls.map(c => c.session?.listId).filter(Boolean))) as string[];
        const lists = await prisma.contactList.findMany({
            where: { id: { in: listIds } },
            select: { id: true, name: true }
        });
        const listMap = new Map(lists.map(l => [l.id, l.name]));

        // Group fetching logic (if applicable)
        // Since the schema doesn't have a direct link from Lead/Call to ContactGroups yet, 
        // we'll leave it as "N/A" or search if possible.
        // Assuming groups are linked to lists or contacts.

        const reportData = calls.map(call => {
            const entity = call.contact || call.lead;
            const phone = call.contact ? call.contact.phones?.[0]?.number : call.lead?.phone;

            return {
                id: call.id,
                name: entity?.fullName || "Unknown",
                address: entity ? `${entity.address || ''}, ${entity.city || ''}, ${entity.state || ''} ${entity.zip || ''}`.replace(/^, | ,|, $/g, '').trim() || "N/A" : "N/A",
                list: call.session?.listId ? (listMap.get(call.session.listId) || "Unknown List") : "N/A",
                group: "N/A", // Group relation not explicitly in schema for CallRecord/Lead
                phoneNumber: phone || "N/A",
                result: call.disposition || call.status,
                startTime: call.startTime,
                duration: call.duration
            };
        });

        successResponse(res, 200, "Call details report fetched successfully", {
            data: reportData,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        console.error("Error generating call details report:", error);
        errorResponse(res, { message: error.message });
    }
};
