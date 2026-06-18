import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import {
  createCalendarEventSchema,
  updateCalendarEventSchema,
} from "../../schemas/calendar.schema";
import { calendarInclude, insertCalendarEventInDb } from "./service";
import { createInternalNotification } from "../notification/controller";

const canManageOthers = (role?: string) => {
  return typeof role === "string" && ["ADMIN", "OWNER"].includes(role.toUpperCase());
};

export const getCalendarEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;
    let whereClause: any = { assignToId: userId, status: "SET" };

    if (role === 'ADMIN' || role === 'OWNER') {
      const agents = await prisma.user.findMany({
        where: { createdById: userId },
        select: { id: true }
      });
      const agentIds = agents.map(a => a.id);
      whereClause = {
        assignToId: { in: [userId, ...agentIds] },
        status: "SET"
      };
    }

    const events = await prisma.calendar.findMany({
      where: whereClause,
      include: calendarInclude,
      orderBy: { startDate: "desc" },
      take: 10
    });

    successResponse(res, 200, "Calendar events fetched", events);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllCalendarEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;
    let whereClause: any = { assignToId: userId };

    if (role === 'ADMIN' || role === 'OWNER') {
      const agents = await prisma.user.findMany({
        where: { createdById: userId },
        select: { id: true }
      });
      const agentIds = agents.map(a => a.id);
      whereClause = {
        assignToId: { in: [userId, ...agentIds] }
      };
    }

    const events = await prisma.calendar.findMany({
      where: whereClause,
      include: calendarInclude,
      orderBy: { startDate: "desc" },
    });

    successResponse(res, 200, "All calendar events fetched", events);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCalendarEventById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    const event = await prisma.calendar.findUnique({
      where: { id },
      include: calendarInclude,
    });

    if (!event) {
      errorResponse(res, "Calendar event not found", 404);
      return;
    }

    if (!canManageOthers(role) && event.assignToId !== userId) {
      errorResponse(res, "You can only access your own calendar events", 403);
      return;
    }

    successResponse(res, 200, "Calendar event fetched", event);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createCalendarEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    const result = await validateData(createCalendarEventSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    const payload = result.data;
    const hasAssignTo = typeof payload.assignToId === "string";

    if (hasAssignTo && !canManageOthers(role)) {
      errorResponse(
        res,
        "Only admins or owners can assign calendar events to other users",
        403
      );
      return;
    }

    const assignToId = hasAssignTo ? payload.assignToId : userId;

    const assignedUser = await prisma.user.findUnique({ where: { id: assignToId } });
    if (!assignedUser) {
      errorResponse(res, "Assigned user not found", 404);
      return;
    }

    const newEvent = await insertCalendarEventInDb({
      title: payload.title,
      description: payload.description,
      color: payload.color,
      eventType: payload.eventType,
      category: payload.category ?? "TASK",
      startDate: payload.startDate,
      endDate: payload.endDate ?? null,
      assignToId,
      assignById: userId,
      status: payload.status ?? "SET",
      contactId: payload.contactId ?? null,
    });

    const populatedEvent = await prisma.calendar.findUnique({
      where: { id: newEvent.id },
      include: calendarInclude,
    });

    const categoryLabel = (payload.category || 'TASK').toLowerCase().replace('_', ' ');
    // Create Notification for the assigned user
    await createInternalNotification(
      assignToId,
      `New ${categoryLabel.charAt(0).toUpperCase() + categoryLabel.slice(1)}: ${payload.title}`,
      `You have been assigned a new ${categoryLabel}.`,
      payload.category === 'APPOINTMENT' ? 'meeting' : 'event'
    );

    successResponse(res, 201, "Calendar event created", populatedEvent);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const updateCalendarEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    const result = await validateData(updateCalendarEventSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    const event = await prisma.calendar.findUnique({ where: { id } });
    if (!event) {
      errorResponse(res, "Calendar event not found", 404);
      return;
    }

    if (!canManageOthers(role) && event.assignToId !== userId) {
      errorResponse(res, "You can only modify your own calendar events", 403);
      return;
    }

    const merged = {
      ...event,
      ...result.data,
    };

    if (merged.eventType === "FROM_TO" && !merged.endDate) {
      errorResponse(res, "endDate is required when eventType is FROM_TO", 400);
      return;
    }

    const updatedEvent = await prisma.calendar.update({
      where: { id },
      data: {
        ...result.data,
      },
      include: calendarInclude,
    });

    successResponse(res, 200, "Calendar event updated", updatedEvent);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteCalendarEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    const event = await prisma.calendar.findUnique({ where: { id } });
    if (!event) {
      errorResponse(res, "Calendar event not found", 404);
      return;
    }

    if (!canManageOthers(role) && event.assignToId !== userId) {
      errorResponse(res, "You can only delete your own calendar events", 403);
      return;
    }

    await prisma.calendar.delete({ where: { id } });
    successResponse(res, 200, "Calendar event deleted", null);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Unified feed for the calendar UI: callbacks + appointments + tasks for the
// authenticated agent within [from, to]. Each item is tagged with `type` so the
// frontend can render/colour them without inspecting the shape.
export const getUnifiedCalendar = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const { from, to } = req.query;

    if (typeof from !== "string" || !from || isNaN(new Date(from).getTime())) {
      errorResponse(res, "A valid `from` date is required", 400);
      return;
    }
    if (typeof to !== "string" || !to || isNaN(new Date(to).getTime())) {
      errorResponse(res, "A valid `to` date is required", 400);
      return;
    }

    const gte = new Date(from);
    const lte = new Date(to);

    const [callbacks, appointments, tasks] = await Promise.all([
      prisma.callback.findMany({
        where: { agentId, scheduledAt: { gte, lte } },
        include: {
          contact: { select: { id: true, fullName: true } },
          lead: { select: { id: true, fullName: true } },
        },
        orderBy: { scheduledAt: "asc" },
      }),
      prisma.appointment.findMany({
        where: { agentId, scheduledAt: { gte, lte } },
        include: { contact: { select: { id: true, fullName: true } } },
        orderBy: { scheduledAt: "asc" },
      }),
      prisma.task.findMany({
        where: { agentId, dueAt: { gte, lte } },
        include: { contact: { select: { id: true, fullName: true } } },
        orderBy: { dueAt: "asc" },
      }),
    ]);

    successResponse(res, 200, "Unified calendar fetched", {
      callbacks: callbacks.map((c) => ({ ...c, type: "CALLBACK" as const })),
      appointments: appointments.map((a) => ({ ...a, type: "APPOINTMENT" as const })),
      tasks: tasks.map((t) => ({ ...t, type: "TASK" as const })),
    });
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCalendarEventsByContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { contactId } = req.params;
    const { id: userId, role } = req.user!;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, userId: true },
    });

    if (!contact) {
      errorResponse(res, "Contact not found", 404);
      return;
    }

    // Check if the user has access to this contact's activities
    if (role === 'AGENT' && contact.userId !== userId) {
      errorResponse(res, "You do not have access to this contact's activities", 403);
      return;
    }

    if ((role === 'ADMIN' || role === 'OWNER')) {
      const targetUser = contact.userId ? await prisma.user.findUnique({
        where: { id: contact.userId },
        select: { createdById: true }
      }) : null;
      if (contact.userId !== userId && targetUser?.createdById !== userId) {
        errorResponse(res, "You do not have access to this contact's activities", 403);
        return;
      }
    }

    const events = await prisma.calendar.findMany({
      where: { contactId },
      include: calendarInclude,
      orderBy: { startDate: "asc" },
    });

    successResponse(res, 200, "Contact calendar events fetched", events);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};


