import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import {
  appointmentInclude,
  createAppointmentInDb,
  getAppointmentByIdInDb,
  listAppointmentsInDb,
  updateAppointmentInDb,
} from "./service";
import {
  syncAppointmentToGoogle,
  deleteAppointmentFromGoogle,
  syncAppointmentToOutlook,
  deleteAppointmentFromOutlook,
} from "../calendarSync/service";

const APPOINTMENT_STATUSES = ["SET", "MET", "CANCELLED", "NO_SHOW"] as const;
const canManageOthers = (role?: string) =>
  typeof role === "string" && ["ADMIN", "OWNER"].includes(role.toUpperCase());

function dateRange(from?: unknown, to?: unknown) {
  const range: { gte?: Date; lte?: Date } = {};
  if (typeof from === "string" && from) range.gte = new Date(from);
  if (typeof to === "string" && to) range.lte = new Date(to);
  return Object.keys(range).length ? range : undefined;
}

export const createAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const { contactId, scheduledAt, duration, notes, location, meetingLink } = req.body ?? {};

    if (!contactId) {
      errorResponse(res, "contactId is required", 400);
      return;
    }
    if (!scheduledAt || isNaN(new Date(scheduledAt).getTime())) {
      errorResponse(res, "A valid scheduledAt date is required", 400);
      return;
    }
    const durationMin = Number(duration);
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      errorResponse(res, "duration (minutes) must be a positive number", 400);
      return;
    }

    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
    if (!contact) {
      errorResponse(res, "Contact not found", 404);
      return;
    }

    const start = new Date(scheduledAt);
    const endsAt = new Date(start.getTime() + durationMin * 60 * 1000);

    const appointment = await createAppointmentInDb({
      agentId,
      contactId,
      scheduledAt: start,
      duration: durationMin,
      endsAt,
      notes: notes ?? null,
      location: location ?? null,
      meetingLink: meetingLink ?? null,
    });

    // Fire-and-forget calendar sync (Google + Outlook)
    Promise.allSettled([
      syncAppointmentToGoogle(agentId, appointment),
      syncAppointmentToOutlook(agentId, appointment),
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
        prisma.appointment
          .update({ where: { id: appointment.id }, data: { externalEventId, externalProvider } })
          .catch(console.error);
      }
    }).catch(console.error);

    successResponse(res, 201, "Appointment created", appointment);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: agentId } = req.user!;
    const { status, from, to } = req.query;

    const where: any = { agentId };
    if (typeof status === "string" && APPOINTMENT_STATUSES.includes(status as any)) where.status = status;
    const scheduledAt = dateRange(from, to);
    if (scheduledAt) where.scheduledAt = scheduledAt;

    const appointments = await listAppointmentsInDb(where);
    successResponse(res, 200, "Appointments fetched", appointments);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAppointmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;

    const appointment = await getAppointmentByIdInDb(id);
    if (!appointment) {
      errorResponse(res, "Appointment not found", 404);
      return;
    }
    if (!canManageOthers(role) && appointment.agentId !== agentId) {
      errorResponse(res, "You can only access your own appointments", 403);
      return;
    }

    successResponse(res, 200, "Appointment fetched", appointment);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const updateAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;
    const { status, scheduledAt, duration, notes, location, meetingLink } = req.body ?? {};

    const appointment = await getAppointmentByIdInDb(id);
    if (!appointment) {
      errorResponse(res, "Appointment not found", 404);
      return;
    }
    if (!canManageOthers(role) && appointment.agentId !== agentId) {
      errorResponse(res, "You can only modify your own appointments", 403);
      return;
    }

    const data: any = {};
    if (status !== undefined) {
      if (!APPOINTMENT_STATUSES.includes(status)) {
        errorResponse(res, `status must be one of: ${APPOINTMENT_STATUSES.join(", ")}`, 400);
        return;
      }
      data.status = status;
    }
    if (notes !== undefined) data.notes = notes;
    if (location !== undefined) data.location = location;
    if (meetingLink !== undefined) data.meetingLink = meetingLink;

    // scheduledAt / duration changes recompute endsAt.
    const newStart = scheduledAt !== undefined ? new Date(scheduledAt) : appointment.scheduledAt;
    const newDuration = duration !== undefined ? Number(duration) : appointment.duration;
    if (scheduledAt !== undefined) {
      if (isNaN(new Date(scheduledAt).getTime())) {
        errorResponse(res, "scheduledAt must be a valid date", 400);
        return;
      }
      data.scheduledAt = newStart;
    }
    if (duration !== undefined) {
      if (!Number.isFinite(newDuration) || newDuration <= 0) {
        errorResponse(res, "duration (minutes) must be a positive number", 400);
        return;
      }
      data.duration = newDuration;
    }
    if (scheduledAt !== undefined || duration !== undefined) {
      data.endsAt = new Date(newStart.getTime() + newDuration * 60 * 1000);
    }

    // Cancelling an appointment releases the contact back into the dial queue.
    const releaseContactId = status === "CANCELLED" ? appointment.contactId : null;

    const updated = await updateAppointmentInDb(id, data, releaseContactId);

    if (status === "CANCELLED" && appointment.externalEventId) {
      deleteAppointmentFromGoogle(appointment.agentId, appointment.externalEventId).catch(console.error);
      deleteAppointmentFromOutlook(appointment.agentId, appointment.externalEventId).catch(console.error);
    } else {
      Promise.allSettled([
        syncAppointmentToGoogle(appointment.agentId, { ...updated, externalEventId: updated.externalEventId }),
        syncAppointmentToOutlook(appointment.agentId, { ...updated, externalEventId: updated.externalEventId }),
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
        if (externalEventId && externalProvider && externalEventId !== updated.externalEventId) {
          prisma.appointment
            .update({ where: { id: updated.id }, data: { externalEventId, externalProvider } })
            .catch(console.error);
        }
      }).catch(console.error);
    }

    successResponse(res, 200, "Appointment updated", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Soft delete: mark CANCELLED and release the contact back to ACTIVE.
export const deleteAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: agentId, role } = req.user!;

    const appointment = await getAppointmentByIdInDb(id);
    if (!appointment) {
      errorResponse(res, "Appointment not found", 404);
      return;
    }
    if (!canManageOthers(role) && appointment.agentId !== agentId) {
      errorResponse(res, "You can only cancel your own appointments", 403);
      return;
    }

    const updated = await updateAppointmentInDb(id, { status: "CANCELLED" }, appointment.contactId);

    if (appointment.externalEventId) {
      deleteAppointmentFromGoogle(appointment.agentId, appointment.externalEventId).catch(console.error);
      deleteAppointmentFromOutlook(appointment.agentId, appointment.externalEventId).catch(console.error);
    }

    successResponse(res, 200, "Appointment cancelled", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export { appointmentInclude };
