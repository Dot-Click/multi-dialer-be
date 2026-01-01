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
  contactListId: string;
  tags: string[];
  dataDialerId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.contactList.findUnique({
      where: { id: payload.contactListId },
      select: { id: true },
    });
    if (!list) throwHttp(404, "ContactList not found");

    const created = await tx.contact.create({
      data: {
        fullName: payload.fullName,
        address: payload.address,
        email: payload.email,
        city: payload.city,
        state: payload.state,
        zip: payload.zip,
        phoneNumber: payload.phoneNumber,
        phoneType: payload.phoneType as any,
        tags: payload.tags ?? [],
        dataDialerId: payload.dataDialerId,
      },
    });

    await tx.contactList.update({
      where: { id: payload.contactListId },
      data: { contactIds: { push: created.id } },
    });

    return created;
  });
}

export async function getAllContactsFromDb() {
  return prisma.contact.findMany({
    orderBy: { id: "desc" },
  });
}

export async function getContactByIdFromDb(id: string) {
  const contact = await prisma.contact.findUnique({
    where: { id },
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
    tags: string[];
    dataDialerId: string | null;
  }>
) {
  const existing = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throwHttp(404, "Contact not found");
 
  return prisma.contact.update({
    where: { id },
    data: {
      ...payload,
      phoneType: payload.phoneType ? (payload.phoneType as any) : undefined,
    },
  });
}

export async function deleteContactFromDb(id: string) {
  const existing = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throwHttp(404, "Contact not found");

  await prisma.$transaction(async (tx) => {
    // Remove the contactId from any ContactList.contactIds arrays
    const lists = await tx.contactList.findMany({
      where: { contactIds: { has: id } },
      select: { id: true, contactIds: true },
    });

    for (const l of lists) {
      await tx.contactList.update({
        where: { id: l.id },
        data: { contactIds: l.contactIds.filter((cid: string) => cid !== id) },
      });
    }

    await tx.contact.delete({ where: { id } });
  });

  return true;
}


