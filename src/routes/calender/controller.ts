import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import {
  createCalendarEventSchema,
  updateCalendarEventSchema,
} from "../../schemas/calendar.schema";
import { calendarInclude, insertCalendarEventInDb } from "./service";

const canManageOthers = (role?: string) => {
  return typeof role === "string" && ["ADMIN", "OWNER"].includes(role.toUpperCase());
};

export const getCalendarEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    const events = await prisma.calendar.findMany({
      where: canManageOthers(role) ? {} : { assignToId: userId },
      include: calendarInclude,
      orderBy: { startDate: "desc" },
    });

    successResponse(res, 200, "Calendar events fetched", events);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllCalendarEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const events = await prisma.calendar.findMany({
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
      startDate: payload.startDate,
      endDate: payload.endDate ?? null,
      assignToId,
      assignById: userId,
    });

    const populatedEvent = await prisma.calendar.findUnique({
      where: { id: newEvent.id },
      include: calendarInclude,
    });

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

