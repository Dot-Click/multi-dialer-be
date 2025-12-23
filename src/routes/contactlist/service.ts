import prisma from "../../lib/prisma";

function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

export async function createListInDb(payload: {
  name: string;
  tag: "INTERESTED" | "FOLLOW_UP" | "DNC" | "NOT_INTERESTED";
  agentIds: string[];
}) {
  const agentIds = Array.from(new Set((payload.agentIds || []).filter(Boolean)));

  return prisma.list.create({
    data: {
      name: payload.name,
      tag: payload.tag as any,
      ...(agentIds.length > 0 ? { agents: { connect: agentIds.map((id) => ({ id })) } } : {}),
    },
    include: {
      agents: { select: { id: true, fullName: true, email: true, role: true } },
      _count: { select: { contacts: true } },
    },
  });
}

export async function getAllListsFromDb() {
  return prisma.list.findMany({
    orderBy: { id: "desc" },
    include: {
      agents: { select: { id: true, fullName: true, email: true, role: true } },
      _count: { select: { contacts: true } },
    },
  });
}

export async function getListByIdFromDb(id: string) {
  const list = await prisma.list.findUnique({
    where: { id },
    include: {
      agents: { select: { id: true, fullName: true, email: true, role: true } },
      contacts: true,
    },
  });
  if (!list) throwHttp(404, "List not found");
  return list;
}

export async function updateListInDb(
  id: string,
  payload: Partial<{ name: string; tag: "INTERESTED" | "FOLLOW_UP" | "DNC" | "NOT_INTERESTED"; agentIds: string[] }>
) {
  const existing = await prisma.list.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throwHttp(404, "List not found");

  const agentIds = payload.agentIds !== undefined ? Array.from(new Set(payload.agentIds.filter(Boolean))) : undefined;

  return prisma.list.update({
    where: { id },
    data: {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.tag !== undefined ? { tag: payload.tag as any } : {}),
      ...(agentIds !== undefined ? { agents: { set: agentIds.map((uid) => ({ id: uid })) } } : {}),
    },
    include: {
      agents: { select: { id: true, fullName: true, email: true, role: true } },
      _count: { select: { contacts: true } },
    },
  });
}

export async function deleteListFromDb(id: string) {
  const existing = await prisma.list.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throwHttp(404, "List not found");
  await prisma.list.delete({ where: { id } });
  return true;
}


