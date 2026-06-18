import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";

export const taskInclude = {
  contact: { select: { id: true, fullName: true } },
  agent: { select: { id: true, fullName: true, email: true } },
};

export async function createTaskInDb(data: {
  agentId: string;
  contactId: string;
  title: string;
  dueAt: Date;
  notes?: string | null;
}) {
  return prisma.task.create({
    data: {
      agentId: data.agentId,
      contactId: data.contactId,
      title: data.title,
      dueAt: data.dueAt,
      notes: data.notes ?? null,
    },
    include: taskInclude,
  });
}

export async function listTasksInDb(where: Prisma.TaskWhereInput) {
  return prisma.task.findMany({
    where,
    include: taskInclude,
    orderBy: { dueAt: "asc" },
  });
}

export async function getTaskByIdInDb(id: string) {
  return prisma.task.findUnique({ where: { id }, include: taskInclude });
}

export async function updateTaskInDb(id: string, data: Prisma.TaskUpdateInput) {
  return prisma.task.update({ where: { id }, data, include: taskInclude });
}
