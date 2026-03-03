import prisma from "../../lib/prisma";

function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

export async function createContactInDb(payload: {
  fullName: string;
  city?: string;
  state?: string;
  zip?: string;
  source?: string;
  tags: string[];
  dataDialerId?: string;
  emails: { email: string; isPrimary: boolean }[];
  phones: { number: string; type: any }[];
  contactListId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    if (payload.contactListId) {
      const list = await tx.contactList.findUnique({
        where: { id: payload.contactListId },
        select: { id: true },
      });
      if (!list) throwHttp(404, "ContactList not found");
    }

    const created = await tx.contact.create({
      data: {
        fullName: payload.fullName,
        city: payload.city,
        state: payload.state,
        zip: payload.zip,
        source: payload.source,
        tags: payload.tags ?? [],
        dataDialerId: payload.dataDialerId,
        emails: {
          create: payload.emails.map((e) => ({
            email: e.email,
            isPrimary: e.isPrimary,
          })),
        },
        phones: {
          create: payload.phones.map((p) => ({
            number: p.number,
            type: p.type,
          })),
        },
      },
      include: {
        emails: true,
        phones: true,
      },
    });

    if (payload.contactListId) {
      await tx.contactList.update({
        where: { id: payload.contactListId },
        data: { contactIds: { push: created.id } },
      });
    }

    return created;
  });
}

export async function getAllContactsFromDb() {
  return prisma.contact.findMany({
    include: {
      emails: true,
      phones: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getContactByIdFromDb(id: string) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      emails: true,
      phones: true,
    },
  });
  if (!contact) throwHttp(404, "Contact not found");
  return contact;
}

export async function updateContactInDb(
  id: string,
  payload: Partial<{
    fullName: string;
    city: string;
    state: string;
    zip: string;
    source: string;
    tags: string[];
    dataDialerId: string | null;
    emails: { email: string; isPrimary: boolean }[];
    phones: { number: string; type: any }[];
  }>,
) {
  const existing = await prisma.contact.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throwHttp(404, "Contact not found");

  return prisma.contact.update({
    where: { id },
    data: {
      fullName: payload.fullName,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      source: payload.source,
      tags: payload.tags,
      dataDialerId: payload.dataDialerId,
      emails: payload.emails
        ? {
            deleteMany: {},
            create: payload.emails.map((e) => ({
              email: e.email,
              isPrimary: e.isPrimary,
            })),
          }
        : undefined,
      phones: payload.phones
        ? {
            deleteMany: {},
            create: payload.phones.map((p) => ({
              number: p.number,
              type: p.type,
            })),
          }
        : undefined,
    },
    include: {
      emails: true,
      phones: true,
    },
  });
}

export async function deleteContactFromDb(id: string) {
  const existing = await prisma.contact.findUnique({
    where: { id },
    select: { id: true },
  });
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

export async function createContactListInDb(
  payload: {
    name: string;
    contactIds: string[];
  },
  userId: string,
) {
  return prisma.contactList.create({
    data: {
      name: payload.name,
      contactIds: payload.contactIds,
      userId,
    },
  });
}

export async function updateContactListInDb(
  id: string,
  payload: {
    name?: string;
    contactIds?: string[];
  },
) {
  return prisma.contactList.update({
    where: { id },
    data: {
      name: payload.name,
      contactIds: payload.contactIds
        ? {
            push: payload.contactIds,
          }
        : undefined,
    },
  });
}

export async function createContactFolderInDb(
  payload: {
    name: string;
    listIds: string[];
  },
  userId: string,
) {
  return prisma.cotactFolder.create({
    data: {
      name: payload.name,
      listIds: payload.listIds,
      userId,
    },
  });
}

export async function updateContactFolderInDb(
  id: string,
  payload: {
    name?: string;
    listIds?: string[];
  },
) {
  return prisma.cotactFolder.update({
    where: { id },
    data: {
      name: payload.name,
      listIds: payload.listIds
        ? {
            push: payload.listIds,
          }
        : undefined,
    },
  });
}

export async function createContactGroupInDb(
  userId: string,
  payload: {
    name: string;
    contactIds: string[];
  },
) {
  return prisma.contactGroups.create({
    data: {
      name: payload.name,
      contactIds: payload.contactIds,
      userId,
    },
  });
}

export async function updateContactGroupInDb(
  id: string,
  payload: {
    name?: string;
    contactIds?: string[];
  },
) {
  return prisma.contactGroups.update({
    where: { id },
    data: {
      name: payload.name,
      contactIds: payload.contactIds
        ? {
            push: payload.contactIds,
          }
        : undefined,
    },
  });
}

export async function deleteContactListFromDb(id: string) {
  return prisma.contactList.delete({ where: { id } });
}

export async function deleteContactFolderFromDb(id: string) {
  return prisma.cotactFolder.delete({ where: { id } });
}

export async function deleteContactGroupFromDb(id: string) {
  return prisma.contactGroups.delete({ where: { id } });
}

export async function getAllContactListsFromDb(userId: string) {
  return prisma.contactList.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllContactFoldersFromDb(userId: string) {
  return prisma.cotactFolder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllContactGroupsFromDb(userId: string) {
  return prisma.contactGroups.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getContactsByListFromDb(listId: string) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.contactList.findUnique({
      where: { id: listId },
      select: {
        contactIds: true,
      },
    });

    if (!list) throwHttp(404, "Contact list not found");

    const contacts = await tx.contact.findMany({
      where: { id: { in: list.contactIds } },
      include: {
        emails: true,
        phones: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return contacts;
  });
}

export async function importContactsFromCsvInDb(args: {
  userId: string;
  fileName: string;
  type: string;
  contactListId?: string;
  contactGroupId?: string;
  keepOld: boolean;
  contacts: any[];
}) {
  const {
    userId,
    fileName,
    type,
    contactListId,
    contactGroupId,
    keepOld,
    contacts,
  } = args;

  return prisma.$transaction(async (tx) => {
    // 1. Create contacts and collect their IDs
    const createdContactIds: string[] = [];
    for (const c of contacts) {
      const created = await tx.contact.create({
        data: {
          fullName: c.fullName || "Unnamed",
          city: c.city,
          state: c.state,
          zip: c.zip,
          source: c.source,
          tags: c.tags || [],
          notes: c.notes,
          emails: {
            create: c.emails
              ? c.emails.map((e: any) => ({
                  email: e.email,
                  isPrimary: e.isPrimary,
                }))
              : [],
          },
          phones: {
            create: c.phones
              ? c.phones.map((p: any) => ({ number: p.number, type: p.type }))
              : [],
          },
        },
      });
      createdContactIds.push(created.id);
    }

    // 2. Connect to List or Group
    if (contactListId) {
      const list = await tx.contactList.findUnique({
        where: { id: contactListId },
      });
      if (!list) throwHttp(404, "Contact list not found");

      await tx.contactList.update({
        where: { id: contactListId },
        data: { contactIds: { push: createdContactIds } },
      });
    } else if (contactGroupId) {
      const group = await tx.contactGroups.findUnique({
        where: { id: contactGroupId },
      });
      if (!group) throwHttp(404, "Contact group not found");

      await tx.contactGroups.update({
        where: { id: contactGroupId },
        data: { contactIds: { push: createdContactIds } },
      });
    }

    // 3. Record the import
    return tx.importContact.create({
      data: {
        fileName,
        type,
        contactListId,
        contactGroupId,
        keepOld,
        contactsCount: createdContactIds.length,
        userId,
      },
    });
  });
}

export async function getAllImportContactsFromDb(userId: string) {
  return prisma.importContact.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      contactList: {
        select: { name: true },
      },
      contactGroup: {
        select: { name: true },
      },
      user: {
        select: {
          fullName: true,
          email: true,
          role: true,
        },
      },
    },
  });
}
