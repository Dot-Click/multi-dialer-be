import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/handler";
import { resolveTenantUserIds } from "@/utils/tenant";
import { RequestHandler } from "express";

/**
 * Recurring Events report (read-only).
 * Aggregates existing outreach per contact:
 *   - Email → EmailLog          (Type = "Email")
 *   - SMS   → SmsLog            (Type = "SMS")
 *   - Any disposition the contact was marked with → ContactDispositionLog
 *     (Type = the disposition's name, e.g. "Contacted", "No Answer", "Call Back")
 * Columns: Name, Start Date (first occurrence), Repeat (occurrence count), Type.
 * Scoped to the caller's tenant (admin + agents); a specific agent if selected.
 */
export const getRecurringEventsReport: RequestHandler = async (req, res) => {
  try {
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;

    if (!requesterId) {
      errorResponse(res, { message: "Unauthorized" }, 401);
      return;
    }

    const { userId: queryUserId } = req.query;

    // Scope: a specific agent when an admin/owner picked one, else the whole
    // tenant pool. resolveTenantUserIds returns null for OWNER (sees all).
    let userIds: string[] | null;
    if ((requesterRole === "ADMIN" || requesterRole === "OWNER") && queryUserId) {
      userIds = [queryUserId as string];
    } else {
      userIds = await resolveTenantUserIds(requesterId);
    }

    const ownerFilter = userIds === null ? {} : { userId: { in: userIds } };
    const appliedByFilter = userIds === null ? {} : { appliedById: { in: userIds } };

    const [emailGroups, smsGroups, dispoGroups] = await Promise.all([
      prisma.emailLog.groupBy({
        by: ["contactId"],
        where: { ...ownerFilter, contactId: { not: null } },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      prisma.smsLog.groupBy({
        by: ["contactId"],
        where: { ...ownerFilter, contactId: { not: null } },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      // ANY disposition the contact was marked with — grouped per disposition so
      // the Type column shows the disposition's actual name.
      prisma.contactDispositionLog.groupBy({
        by: ["contactId", "dispositionId"],
        where: { ...appliedByFilter },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
    ]);

    // Resolve contact names in one query.
    const contactIds = [
      ...new Set(
        [...emailGroups, ...smsGroups, ...dispoGroups]
          .map((g) => g.contactId)
          .filter((id): id is string => !!id),
      ),
    ];
    const contacts = contactIds.length
      ? await prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(contacts.map((c) => [c.id, c.fullName]));

    // Resolve disposition names → used as the Type for disposition rows.
    const dispositionIds = [...new Set(dispoGroups.map((g) => g.dispositionId).filter(Boolean))];
    const dispositions = dispositionIds.length
      ? await prisma.disposition.findMany({
          where: { id: { in: dispositionIds } },
          select: { id: true, label: true, value: true },
        })
      : [];
    const dispoNameById = new Map(dispositions.map((d) => [d.id, d.label || d.value]));

    const rows = [
      ...emailGroups
        .filter((g) => g.contactId)
        .map((g) => ({
          contactId: g.contactId as string,
          name: nameById.get(g.contactId as string) || "Unknown",
          type: "Email",
          repeat: g._count._all,
          startDate: g._min.createdAt,
        })),
      ...smsGroups
        .filter((g) => g.contactId)
        .map((g) => ({
          contactId: g.contactId as string,
          name: nameById.get(g.contactId as string) || "Unknown",
          type: "SMS",
          repeat: g._count._all,
          startDate: g._min.createdAt,
        })),
      ...dispoGroups
        .filter((g) => g.contactId)
        .map((g) => ({
          contactId: g.contactId as string,
          name: nameById.get(g.contactId as string) || "Unknown",
          type: dispoNameById.get(g.dispositionId) || "Disposition",
          repeat: g._count._all,
          startDate: g._min.createdAt,
        })),
    ].sort((a, b) => (b.startDate?.getTime() || 0) - (a.startDate?.getTime() || 0));

    successResponse(res, 200, "Recurring events fetched", { data: rows });
  } catch (error: any) {
    console.error("Error generating recurring events report:", error);
    errorResponse(res, { message: error.message });
  }
};
