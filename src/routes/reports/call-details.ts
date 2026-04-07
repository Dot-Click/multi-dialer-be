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

        // Collect IDs — guard against empty arrays before using hasSome
        const sessionListIds = Array.from(
            new Set(calls.map(c => c.session?.listId).filter((id): id is string => !!id))
        );
        const contactIds = Array.from(
            new Set(calls.map(c => c.contact?.id).filter((id): id is string => !!id))
        );

        // Build the OR clauses only when the arrays are non-empty.
        // hasSome: [] is undefined behaviour in Prisma/Postgres and silently
        // drops rows, which causes lists/folders to "disappear".
        const listOrClauses: any[] = [];
        if (sessionListIds.length > 0) {
            listOrClauses.push({ id: { in: sessionListIds } });
        }
        if (contactIds.length > 0) {
            listOrClauses.push({ contactIds: { hasSome: contactIds } });
        }

        const lists = listOrClauses.length > 0
            ? await prisma.contactList.findMany({
                where: { userId, OR: listOrClauses },
                select: { id: true, name: true, contactIds: true }
            })
            : [];

        // Build list map — only add entries with a real id
        const listMap = new Map<string, string>(
            lists
                .filter(l => !!l.id)
                .map(l => [l.id, l.name])
        );

        // Fetch folders — guard hasSome the same way
        const foundListIds = lists.map(l => l.id).filter((id): id is string => !!id);

        const folders = foundListIds.length > 0
            ? await prisma.contactFolder.findMany({
                where: {
                    userId,
                    listIds: { hasSome: foundListIds }
                },
                select: { id: true, name: true, listIds: true }
            })
            : [];

        // Fetch groups — guard hasSome
        const groups = contactIds.length > 0
            ? await prisma.contactGroups.findMany({
                where: {
                    userId,
                    contactIds: { hasSome: contactIds }
                },
                select: { name: true, contactIds: true }
            })
            : [];

        const reportData = calls.map(call => {
            const entity = call.contact || call.lead;
            const contactId = call.contact?.id;
            const phone = call.contact
                ? call.contact.phones?.[0]?.number
                : call.lead?.phone;

            // ── Determine List ──────────────────────────────────────────────
            let listName = "N/A";

            if (call.session?.listId) {
                // Prefer the session's list — most direct source
                listName = listMap.get(call.session.listId) ?? "Unknown List";
            } else if (contactId) {
                // Fall back to any list that contains this contact
                const list = lists.find(l => l.contactIds.includes(contactId));
                if (list) listName = list.name;
            }

            // ── Determine Folder / Group ────────────────────────────────────
            let groupName = "N/A";

            if (call.session?.listId) {
                // 1. Try to find a folder that owns the session's list
                const folder = folders.find(f => f.listIds.includes(call.session!.listId!));
                if (folder) groupName = folder.name;
            }

            if (groupName === "N/A" && contactId) {
                // 2. Try a ContactGroup that contains this contact
                const group = groups.find(g => g.contactIds.includes(contactId));
                if (group) {
                    groupName = group.name;
                } else {
                    // 3. Find a list for this contact, then a folder for that list
                    const listForContact = lists.find(l => l.contactIds.includes(contactId));
                    if (listForContact?.id) {
                        const folder = folders.find(f => f.listIds.includes(listForContact.id));
                        if (folder) groupName = folder.name;
                    }
                }
            }

            return {
                id: call.id,
                name: entity?.fullName || "Unknown",
                address: entity
                    ? `${entity.address || ""}, ${entity.city || ""}, ${entity.state || ""} ${entity.zip || ""}`
                        .replace(/^,\s*|,\s*,|,\s*$/g, "")
                        .trim() || "N/A"
                    : "N/A",
                list: listName,
                group: groupName,
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