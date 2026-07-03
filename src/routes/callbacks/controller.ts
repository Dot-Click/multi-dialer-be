import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import {
  callbackInclude,
  createCallbackInDb,
  getCallbackByIdInDb,
  listCallbacksInDb,
  updateCallbackInDb,
} from "./service";
import { syncCallbackToGoogle, deleteCallbackFromGoogle, syncCallbackToOutlook, deleteCallbackFromOutlook } from "../calendarSync/service";

const CALLBACK_STATUSES = ["PENDING", "DUE", "COMPLETED", "MISSED", "CANCELLED"] as const;
const canManageOthers = (role?: string) =>
  typeof role === "string" && ["ADMIN", "OWNER"].includes(role.toUpperCase());

// Build a scheduledAt date-range filter from `from`/`to` query params.
function dateRange(from?: unknown, to?: unknown) {
  const range: { gte?: Date; lte?: Date } = {};
  if (typeof from === "string" && from) range.gte = new Date(from);
  if (typeof to === "string" && to) range.lte = new Date(to);
  return Object.keys(range).length ? range : undefined;
}

export const createCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const { contactId, scheduledAt, notes } = req.body ?? {};

    if (!contactId) {
      errorResponse(res, "contactId is required", 400);
      return;
    }
    if (!scheduledAt || isNaN(new Date(scheduledAt).getTime())) {
      errorResponse(res, "A valid scheduledAt date is required", 400);
      return;
    }

    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
    if (!contact) {
      errorResponse(res, "Contact not found", 404);
      return;
    }

    const callback = await createCallbackInDb({
      agentId,
      contactId,
      scheduledAt: new Date(scheduledAt),
      notes: notes ?? null,
    });

    Promise.allSettled([
      syncCallbackToGoogle(agentId, callback),
      syncCallbackToOutlook(agentId, callback),
    ]).then(([googleResult, outlookResult]) => {
      const externalEventId =
        (googleResult.status === "fulfilled" && googleResult.value) ||
        (outlookResult.status === "fulfilled" && outlookResult.value) ||
        null;
      const externalProvider =
        googleResult.status === "fulfilled" && googleResult.value
          ? "GOOGLE"
          : outlookResult.status === "fulfilled" && outlookResult.value
          ? "OUTLOOK"
          : null;
      if (externalEventId && externalProvider) {
        prisma.callback
          .update({ where: { id: callback.id }, data: { externalEventId, externalProvider } })
          .catch(console.error);
      }
    }).catch(console.error);

    successResponse(res, 201, "Callback created", callback);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCallbacks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const { status, from, to } = req.query;

    const where: any = { agentId };
    if (typeof status === "string" && CALLBACK_STATUSES.includes(status as any)) where.status = status;
    const scheduledAt = dateRange(from, to);
    if (scheduledAt) where.scheduledAt = scheduledAt;

    const callbacks = await listCallbacksInDb(where);
    successResponse(res, 200, "Callbacks fetched", callbacks);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Polling endpoint for dialer interruption (frontend polls ~every 30s). Returns
// callbacks the `callbackDue` job has flagged DUE, plus any PENDING ones already
// within the 2-minute window (covers the gap between the 60s job ticks).
export const getDueCallbacks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const cutoff = new Date(Date.now() + 2 * 60 * 1000);

    const callbacks = await listCallbacksInDb({
      agentId,
      OR: [
        { status: "DUE" },
        { status: "PENDING", scheduledAt: { lte: cutoff } },
      ],
    });

    successResponse(res, 200, "Due callbacks fetched", callbacks);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCallbackById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;

    const callback = await getCallbackByIdInDb(id);
    if (!callback) {
      errorResponse(res, "Callback not found", 404);
      return;
    }
    if (!canManageOthers(role) && callback.agentId !== agentId) {
      errorResponse(res, "You can only access your own callbacks", 403);
      return;
    }

    successResponse(res, 200, "Callback fetched", callback);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const updateCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;
    const { status, scheduledAt, notes } = req.body ?? {};

    const callback = await getCallbackByIdInDb(id);
    if (!callback) {
      errorResponse(res, "Callback not found", 404);
      return;
    }
    if (!canManageOthers(role) && callback.agentId !== agentId) {
      errorResponse(res, "You can only modify your own callbacks", 403);
      return;
    }

    const data: any = {};
    if (status !== undefined) {
      if (!CALLBACK_STATUSES.includes(status)) {
        errorResponse(res, `status must be one of: ${CALLBACK_STATUSES.join(", ")}`, 400);
        return;
      }
      data.status = status;
      // Stamp completion time when the callback is marked COMPLETED.
      if (status === "COMPLETED") data.completedAt = new Date();
    }
    if (scheduledAt !== undefined) {
      if (isNaN(new Date(scheduledAt).getTime())) {
        errorResponse(res, "scheduledAt must be a valid date", 400);
        return;
      }
      data.scheduledAt = new Date(scheduledAt);
    }
    if (notes !== undefined) data.notes = notes;

    const updated = await updateCallbackInDb(id, data);

    if ((status === "CANCELLED" || status === "COMPLETED") && callback.externalEventId) {
      deleteCallbackFromGoogle(callback.agentId, callback.externalEventId).catch(console.error);
      deleteCallbackFromOutlook(callback.agentId, callback.externalEventId).catch(console.error);
    } else if (scheduledAt !== undefined && callback.externalEventId) {
      syncCallbackToGoogle(callback.agentId, { ...updated, externalEventId: updated.externalEventId }).catch(console.error);
      syncCallbackToOutlook(callback.agentId, { ...updated, externalEventId: updated.externalEventId }).catch(console.error);
    }

    successResponse(res, 200, "Callback updated", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Soft delete: mark CANCELLED, never hard-delete.
export const deleteCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;

    const callback = await getCallbackByIdInDb(id);
    if (!callback) {
      errorResponse(res, "Callback not found", 404);
      return;
    }
    if (!canManageOthers(role) && callback.agentId !== agentId) {
      errorResponse(res, "You can only cancel your own callbacks", 403);
      return;
    }

    const updated = await updateCallbackInDb(id, { status: "CANCELLED" });

    if (callback.externalEventId) {
      deleteCallbackFromGoogle(callback.agentId, callback.externalEventId).catch(console.error);
      deleteCallbackFromOutlook(callback.agentId, callback.externalEventId).catch(console.error);
    }

    successResponse(res, 200, "Callback cancelled", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export { callbackInclude };
