import prisma from "../../lib/prisma";

function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

export async function createListInDb(
  userId: string,
  payload: {
    name: string;
    agentIds: string[];
    contactIds?: string[];
  },
) {
  const agentIds = Array.from(
    new Set((payload.agentIds || []).filter(Boolean)),
  );
  const contactIds = Array.from(
    new Set((payload.contactIds || []).filter(Boolean)),
  );

  return prisma.contactList.create({
    data: {
      name: payload.name,
      agentIds,
      contactIds,
      userId,
    },
  });
}

export async function getAllListsFromDb(userId: string) {
  return prisma.contactList.findMany({
    where: { userId },
    orderBy: { id: "desc" },
  });
}

export async function getListByIdFromDb(id: string, userId: string) {
  const list = await prisma.contactList.findFirst({
    where: { id, userId },
  });
  if (!list) throwHttp(404, "List not found");
  return list;
}

export async function updateListInDb(
  id: string,
  userId: string,
  payload: Partial<{ name: string; agentIds: string[]; contactIds: string[] }>,
) {
  const existing = await prisma.contactList.findFirst({
    where: { id, userId },
    select: { id: true, name: true, agentIds: true, contactIds: true },
  });
  if (!existing) throwHttp(404, "List not found");

  const contactIds =
    payload.contactIds !== undefined
      ? Array.from(new Set(payload.contactIds.filter(Boolean)))
      : undefined;

  // Merge agentIds (do not overwrite)
  if (payload.agentIds !== undefined) {
    const requestedAgentIds = Array.from(
      new Set(payload.agentIds.filter(Boolean)),
    );

    // 1) Validate all agent IDs exist
    if (requestedAgentIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: requestedAgentIds } },
        select: { id: true },
      });

      if (users.length !== requestedAgentIds.length) {
        throwHttp(404, "Agent with this ID not found");
      }
    }

    // 2) Duplicate check
    const alreadyAssigned = requestedAgentIds.filter((aid) =>
      existing.agentIds.includes(aid),
    );
    const newAgentIds = requestedAgentIds.filter(
      (aid) => !existing.agentIds.includes(aid),
    );

    // If all provided are already assigned, return special success message without updating
    if (requestedAgentIds.length > 0 && newAgentIds.length === 0) {
      return {
        message: "Agent is already assigned to this list",
        list: existing,
      };
    }

    const mergedAgentIds = [...existing.agentIds, ...newAgentIds];

    const updated = await prisma.contactList.update({
      where: { id },

      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        agentIds: mergedAgentIds,
        ...(contactIds !== undefined ? { contactIds } : {}),
      },
    });

    return {
      message:
        newAgentIds.length > 0
          ? "Agent added to contact list successfully"
          : "List updated",
      list: updated,
    };
  }

  // No agentIds provided: normal update for other fields
  const updated = await prisma.contactList.update({
    where: { id },
    data: {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(contactIds !== undefined ? { contactIds } : {}),
    },
  });

  return { message: "List updated", list: updated };
}

export async function deleteListFromDb(id: string, userId: string) {
  const existing = await prisma.contactList.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throwHttp(404, "List not found");
  await prisma.contactList.delete({ where: { id } });
  return true;
}
