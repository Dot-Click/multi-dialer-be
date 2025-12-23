import prisma from "../../lib/prisma";

function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

export async function createContactInDb(payload: {
  fullName: string;
  address: string;
  email: string;
  city: string;
  state: string;
  zip: string;
  phoneNumber: string;
  phoneType: "MOBILE" | "TELEPHONE";
  listId: string;
  dataDialerId?: string;
}) {
  const list = await prisma.list.findUnique({ where: { id: payload.listId }, select: { id: true } });
  if (!list) throwHttp(404, "List not found");

  return prisma.contact.create({
    data: {
      fullName: payload.fullName,
      address: payload.address,
      email: payload.email,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      phoneNumber: payload.phoneNumber,
      phoneType: payload.phoneType as any,
      listId: payload.listId,
      dataDialerId: payload.dataDialerId,
    },
    include: { list: true },
  });
}

export async function getAllContactsFromDb() {
  return prisma.contact.findMany({
    orderBy: { id: "desc" },
    include: { list: true },
  });
}

export async function getContactByIdFromDb(id: string) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { list: true },
  });
  if (!contact) throwHttp(404, "Contact not found");
  return contact;
}

export async function updateContactInDb(
  id: string,
  payload: Partial<{
    fullName: string;
    address: string;
    email: string;
    city: string;
    state: string;
    zip: string;
    phoneNumber: string;
    phoneType: "MOBILE" | "TELEPHONE";
    listId: string;
    dataDialerId: string | null;
  }>
) {
  const existing = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throwHttp(404, "Contact not found");

  if (payload.listId) {
    const list = await prisma.list.findUnique({ where: { id: payload.listId }, select: { id: true } });
    if (!list) throwHttp(404, "List not found");
  }

  return prisma.contact.update({
    where: { id },
    data: {
      ...payload,
      phoneType: payload.phoneType ? (payload.phoneType as any) : undefined,
    },
    include: { list: true },
  });
}

export async function deleteContactFromDb(id: string) {
  const existing = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throwHttp(404, "Contact not found");
  await prisma.contact.delete({ where: { id } });
  return true;
}


