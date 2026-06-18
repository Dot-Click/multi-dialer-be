import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";

export const appointmentInclude = {
  contact: { select: { id: true, fullName: true } },
  agent: { select: { id: true, fullName: true, email: true } },
};

// Create an appointment and park its contact on APPOINTMENT_HOLD, atomically.
export async function createAppointmentInDb(data: {
  agentId: string;
  contactId: string;
  scheduledAt: Date;
  duration: number;
  endsAt: Date;
  notes?: string | null;
  location?: string | null;
  meetingLink?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        agentId: data.agentId,
        contactId: data.contactId,
        scheduledAt: data.scheduledAt,
        duration: data.duration,
        endsAt: data.endsAt,
        notes: data.notes ?? null,
        location: data.location ?? null,
        meetingLink: data.meetingLink ?? null,
      },
      include: appointmentInclude,
    });

    await tx.contact.update({
      where: { id: data.contactId },
      data: { queueStatus: "APPOINTMENT_HOLD" },
    });

    return appointment;
  });
}

export async function listAppointmentsInDb(where: Prisma.AppointmentWhereInput) {
  return prisma.appointment.findMany({
    where,
    include: appointmentInclude,
    orderBy: { scheduledAt: "asc" },
  });
}

export async function getAppointmentByIdInDb(id: string) {
  return prisma.appointment.findUnique({ where: { id }, include: appointmentInclude });
}

// Update an appointment; when it is cancelled, release the contact back to ACTIVE
// (in the same transaction).
export async function updateAppointmentInDb(
  id: string,
  data: Prisma.AppointmentUpdateInput,
  releaseContactId?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.update({
      where: { id },
      data,
      include: appointmentInclude,
    });
    if (releaseContactId) {
      await tx.contact.update({
        where: { id: releaseContactId },
        data: { queueStatus: "ACTIVE" },
      });
    }
    return appointment;
  });
}
