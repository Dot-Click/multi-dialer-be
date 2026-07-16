import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";

export const callbackInclude = {
  contact: {
    select: {
      id: true,
      fullName: true,
      phones: { select: { number: true, isPrimary: true, isValid: true, isDnc: true } },
    },
  },
  lead: { select: { id: true, fullName: true } },
  agent: { select: { id: true, fullName: true, email: true } },
};

// Create a callback and, if it is tied to a contact, park that contact on
// CALLBACK_HOLD so the dialer stops queueing it. Done in one transaction so the
// hold and the callback can never get out of sync.
export async function createCallbackInDb(data: {
  agentId: string;
  contactId?: string | null;
  scheduledAt: Date;
  notes?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const callback = await tx.callback.create({
      data: {
        agentId: data.agentId,
        contactId: data.contactId ?? null,
        scheduledAt: data.scheduledAt,
        notes: data.notes ?? null,
      },
      include: callbackInclude,
    });

    if (data.contactId) {
      await tx.contact.update({
        where: { id: data.contactId },
        data: { queueStatus: "CALLBACK_HOLD" },
      });
    }

    return callback;
  });
}

export async function listCallbacksInDb(where: Prisma.CallbackWhereInput) {
  return prisma.callback.findMany({
    where,
    include: callbackInclude,
    orderBy: { scheduledAt: "asc" },
  });
}

export async function getCallbackByIdInDb(id: string) {
  return prisma.callback.findUnique({ where: { id }, include: callbackInclude });
}

export async function updateCallbackInDb(id: string, data: Prisma.CallbackUpdateInput) {
  return prisma.callback.update({ where: { id }, data, include: callbackInclude });
}
