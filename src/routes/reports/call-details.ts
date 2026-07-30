import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { RequestHandler } from "express";
import { Prisma } from "@prisma/client";

// "HH:mm" -> minutes since midnight; returns null on anything unparseable
function parseTimeToMinutes(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

/**
 * Get call details report
 * Includes: name, address, list, folder, phone number, result
 */
export const getCallDetailsReport: RequestHandler = async (req, res) => {
    try {
        const requesterId = req.user?.id;
        const requesterRole = req.user?.role;

        if (!requesterId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const {
            startDate, endDate, userId: queryUserId, page = 1, limit = 50,
            callerId, dayOfWeek, timeFrameStart, timeFrameEnd
        } = req.query;
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
            if (endDate) {
                // Extend to end of day so records created on that date are included
                const end = new Date(endDate as string);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        if (callerId && callerId !== "all") {
            where.callerIdId = callerId as string;
        }

        // Day-of-week (0=Sun..6=Sat) and time-of-day filters need EXTRACT(), which
        // Prisma's query builder can't express — resolve matching ids via raw SQL
        // first, then constrain the main query with an `id IN (...)`.
        const days = dayOfWeek
            ? (dayOfWeek as string).split(",").map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 6)
            : [];
        const startMinutes = parseTimeToMinutes(timeFrameStart);
        const endMinutes = parseTimeToMinutes(timeFrameEnd);

        if (days.length > 0 || startMinutes !== null || endMinutes !== null) {
            const conditions: Prisma.Sql[] = [Prisma.sql`"userId" = ${userId}`];
            if (days.length > 0) {
                conditions.push(Prisma.sql`EXTRACT(DOW FROM "startTime") IN (${Prisma.join(days)})`);
            }
            if (startMinutes !== null) {
                conditions.push(Prisma.sql`(EXTRACT(HOUR FROM "startTime") * 60 + EXTRACT(MINUTE FROM "startTime")) >= ${startMinutes}`);
            }
            if (endMinutes !== null) {
                conditions.push(Prisma.sql`(EXTRACT(HOUR FROM "startTime") * 60 + EXTRACT(MINUTE FROM "startTime")) <= ${endMinutes}`);
            }

            const matchingIds = await prisma.$queryRaw<{ id: string }[]>(
                Prisma.sql`SELECT id FROM call_records WHERE ${Prisma.join(conditions, " AND ")}`
            );
            where.id = { in: matchingIds.map((r) => r.id) };
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

        // Fetch folders — a folder can own the contact's list (listIds) and/or
        // contain the contact directly (contactIds). Guard hasSome on both.
        const foundListIds = lists.map(l => l.id).filter((id): id is string => !!id);

        const folderOrClauses: any[] = [];
        if (foundListIds.length > 0) folderOrClauses.push({ listIds: { hasSome: foundListIds } });
        if (contactIds.length > 0) folderOrClauses.push({ contactIds: { hasSome: contactIds } });

        const folders = folderOrClauses.length > 0
            ? await prisma.contactFolder.findMany({
                where: { userId, OR: folderOrClauses },
                select: { id: true, name: true, listIds: true, contactIds: true }
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

            // ── Determine Folder ────────────────────────────────────────────
            let folderName = "N/A";

            if (call.session?.listId) {
                // 1. Folder that owns the session's list
                const folder = folders.find(f => f.listIds.includes(call.session!.listId!));
                if (folder) folderName = folder.name;
            }

            if (folderName === "N/A" && contactId) {
                // 2. Folder that contains this contact directly
                const direct = folders.find(f => f.contactIds.includes(contactId));
                if (direct) {
                    folderName = direct.name;
                } else {
                    // 3. Folder that owns a list this contact belongs to
                    const listForContact = lists.find(l => l.contactIds.includes(contactId));
                    if (listForContact?.id) {
                        const folder = folders.find(f => f.listIds.includes(listForContact.id));
                        if (folder) folderName = folder.name;
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
                folder: folderName,
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