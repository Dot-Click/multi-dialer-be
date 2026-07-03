import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import {
  taskInclude,
  createTaskInDb,
  getTaskByIdInDb,
  listTasksInDb,
  updateTaskInDb,
} from "./service";
import { syncTaskToGoogle, deleteTaskFromGoogle, syncTaskToOutlook, deleteTaskFromOutlook } from "../calendarSync/service";

const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
const canManageOthers = (role?: string) =>
  typeof role === "string" && ["ADMIN", "OWNER"].includes(role.toUpperCase());

function dateRange(from?: unknown, to?: unknown) {
  const range: { gte?: Date; lte?: Date } = {};
  if (typeof from === "string" && from) range.gte = new Date(from);
  if (typeof to === "string" && to) range.lte = new Date(to);
  return Object.keys(range).length ? range : undefined;
}

export const createTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const { contactId, title, dueAt, notes } = req.body ?? {};

    if (!contactId) {
      errorResponse(res, "contactId is required", 400);
      return;
    }
    if (!title || typeof title !== "string") {
      errorResponse(res, "title is required", 400);
      return;
    }
    if (!dueAt || isNaN(new Date(dueAt).getTime())) {
      errorResponse(res, "A valid dueAt date is required", 400);
      return;
    }

    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
    if (!contact) {
      errorResponse(res, "Contact not found", 404);
      return;
    }

    const task = await createTaskInDb({
      agentId,
      contactId,
      title,
      dueAt: new Date(dueAt),
      notes: notes ?? null,
    });

    Promise.allSettled([
      syncTaskToGoogle(agentId, task),
      syncTaskToOutlook(agentId, task),
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
        prisma.task
          .update({ where: { id: task.id }, data: { externalEventId, externalProvider } })
          .catch(console.error);
      }
    }).catch(console.error);

    successResponse(res, 201, "Task created", task);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const { status, from, to } = req.query;

    const where: any = { agentId };
    if (typeof status === "string" && TASK_STATUSES.includes(status as any)) where.status = status;
    const dueAt = dateRange(from, to);
    if (dueAt) where.dueAt = dueAt;

    const tasks = await listTasksInDb(where);
    successResponse(res, 200, "Tasks fetched", tasks);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getTaskById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;

    const task = await getTaskByIdInDb(id);
    if (!task) {
      errorResponse(res, "Task not found", 404);
      return;
    }
    if (!canManageOthers(role) && task.agentId !== agentId) {
      errorResponse(res, "You can only access your own tasks", 403);
      return;
    }

    successResponse(res, 200, "Task fetched", task);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const updateTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;
    const { status, title, notes, dueAt } = req.body ?? {};

    const task = await getTaskByIdInDb(id);
    if (!task) {
      errorResponse(res, "Task not found", 404);
      return;
    }
    if (!canManageOthers(role) && task.agentId !== agentId) {
      errorResponse(res, "You can only modify your own tasks", 403);
      return;
    }

    const data: any = {};
    if (status !== undefined) {
      if (!TASK_STATUSES.includes(status)) {
        errorResponse(res, `status must be one of: ${TASK_STATUSES.join(", ")}`, 400);
        return;
      }
      data.status = status;
    }
    if (title !== undefined) data.title = title;
    if (notes !== undefined) data.notes = notes;
    if (dueAt !== undefined) {
      if (isNaN(new Date(dueAt).getTime())) {
        errorResponse(res, "dueAt must be a valid date", 400);
        return;
      }
      data.dueAt = new Date(dueAt);
    }

    const updated = await updateTaskInDb(id, data);

    if ((status === "DONE" || status === "CANCELLED") && task.externalEventId) {
      deleteTaskFromGoogle(task.agentId, task.externalEventId).catch(console.error);
      deleteTaskFromOutlook(task.agentId, task.externalEventId).catch(console.error);
    } else if (dueAt !== undefined && task.externalEventId) {
      syncTaskToGoogle(task.agentId, { ...updated, externalEventId: updated.externalEventId }).catch(console.error);
      syncTaskToOutlook(task.agentId, { ...updated, externalEventId: updated.externalEventId }).catch(console.error);
    }

    successResponse(res, 200, "Task updated", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Soft delete: mark CANCELLED, never hard-delete.
export const deleteTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;

    const task = await getTaskByIdInDb(id);
    if (!task) {
      errorResponse(res, "Task not found", 404);
      return;
    }
    if (!canManageOthers(role) && task.agentId !== agentId) {
      errorResponse(res, "You can only cancel your own tasks", 403);
      return;
    }

    const updated = await updateTaskInDb(id, { status: "CANCELLED" });

    if (task.externalEventId) {
      deleteTaskFromGoogle(task.agentId, task.externalEventId).catch(console.error);
      deleteTaskFromOutlook(task.agentId, task.externalEventId).catch(console.error);
    }

    successResponse(res, 200, "Task cancelled", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export { taskInclude };
