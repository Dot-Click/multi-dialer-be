import prisma from "../../lib/prisma";
import { leadSheetEmailTemp, sendEmail } from "../../utils/email";
import path from "path";
import fs from "fs";
import { cloudinaryUploader } from "../../utils/handler";
import { randomUUID } from "crypto";

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
        phones: { where: { isDnc: false } },
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

export async function getAllContactsFromDb(userId: string, role: string) {
  // OWNER — sees everything, no filter needed
  if (role === "OWNER") {
    return prisma.contact.findMany({
      where: {
        phones: { some: { isDnc: false } },
      },
      include: {
        emails: true,
        phones: { where: { isDnc: false } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // ADMIN — sees contacts owned by themselves or any of their agents,
  // plus any contacts that appear in lists they own.
  if (role === "ADMIN") {
    const poolUserIds = await getAdminUserPool(userId);

    const myLists = await prisma.contactList.findMany({
      where: {
        OR: [{ userId: { in: poolUserIds } }, { userId: null }],
      },
      select: { contactIds: true },
    });
    const listContactIds = [...new Set(myLists.flatMap((l) => l.contactIds))];

    return prisma.contact.findMany({
      where: {
        AND: [
          {
            OR: [
              { userId: { in: poolUserIds } },
              { id: { in: listContactIds } },
            ],
          },
          { phones: { some: { isDnc: false } } },
        ],
      },
      include: {
        emails: true,
        phones: { where: { isDnc: false } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // AGENT — sees:
  //   1. Contacts that live inside lists their admin assigned them to
  //   2. Contacts they personally created (userId === agent's id)
  if (role === "AGENT") {
    const assignedLists = await prisma.contactList.findMany({
      where: { agentIds: { has: userId } },
      select: { contactIds: true },
    });
    const assignedContactIds = [
      ...new Set(assignedLists.flatMap((l) => l.contactIds)),
    ];

    return prisma.contact.findMany({
      where: {
        AND: [
          {
            OR: [
              { id: { in: assignedContactIds } },
              { userId: userId },
            ],
          },
          { phones: { some: { isDnc: false } } },
        ],
      },
      include: {
        emails: true,
        phones: { where: { isDnc: false } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // Fallback — own contacts only
  return prisma.contact.findMany({
    where: {
      userId,
      phones: { some: { isDnc: false } },
    },
    include: {
      emails: true,
      phones: { where: { isDnc: false } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getContactByIdFromDb(id: string) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      emails: true,
      phones: { where: { isDnc: false } },
      attachments: true,
      callRecords: {
        include: {
          user: { select: { fullName: true } },
        },
        orderBy: { startTime: "desc" },
      },
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
  }>
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
      phones: { where: { isDnc: false } },
    },
  });
}

export async function deleteContactFromDb(id: string, userId: string) {
  const existing = await prisma.contact.findUnique({
    where: { id },
    select: { id: true, fullName: true },
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
        data: { contactIds: l.contactIds.filter((cid) => cid !== id) },
      });
    }

    // Scrub from ContactGroups as well
    const groups = await tx.contactGroups.findMany({
      where: { contactIds: { has: id } },
      select: { id: true, contactIds: true },
    });
    for (const g of groups) {
      await tx.contactGroups.update({
        where: { id: g.id },
        data: { contactIds: g.contactIds.filter((cid) => cid !== id) },
      });
    }

    // Create Audit Log
    await tx.auditLog.create({
      data: {
        userId,
        action: `Deleted contact: ${existing.fullName}`,
        details: `ID: ${id}`,
      }
    });

    await tx.contact.delete({ where: { id } });
  });

  return true;
}

export async function createContactListInDb(payload: {
  name: string;
  contactIds: string[];
}, userId: string) {
  return prisma.contactList.create({
    data: {
      name: payload.name,
      contactIds: payload.contactIds,
      userId,
    },
  });
}

export async function updateContactListInDb(id: string, payload: {
  name?: string;
  contactIds?: string[];
}) {
  return prisma.contactList.update({
    where: { id },
    data: {
      name: payload.name,
      contactIds: payload.contactIds ? {
        push: payload.contactIds,
      } : undefined,
    },
  });
}

export async function deleteContactListFromDb(id: string) {
  return prisma.contactList.delete({ where: { id } });
}

export async function getAllContactListsFromDb(userId: string, role?: string) {
  if (role === "OWNER") {
    return prisma.contactList.findMany({ orderBy: { createdAt: "desc" } });
  }

  if (role === "ADMIN") {
    const poolUserIds = await getAdminUserPool(userId);
    return prisma.contactList.findMany({
      where: {
        OR: [{ userId: { in: poolUserIds } }, { userId: null }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (role === "AGENT") {
    // Agents see lists explicitly assigned to them by their admin
    return prisma.contactList.findMany({
      where: { agentIds: { has: userId } },
      orderBy: { createdAt: "desc" },
    });
  }

  return prisma.contactList.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getContactsByListFromDb(
  listId: string,
  userId: string,
  role: string
) {
  const list = await prisma.contactList.findUnique({
    where: { id: listId },
    select: { contactIds: true, agentIds: true, userId: true },
  });
  if (!list) throwHttp(404, "List not found");

  // AGENT: must be explicitly assigned to this list
  if (role === "AGENT") {
    if (!list.agentIds.includes(userId)) {
      throwHttp(403, "Access denied to this list");
    }
  }

  // ADMIN: list must belong to them or one of their agents (or be a system list)
  if (role === "ADMIN") {
    if (list.userId !== null) {
      const poolUserIds = await getAdminUserPool(userId);
      if (!poolUserIds.includes(list.userId)) {
        throwHttp(403, "Access denied to this list");
      }
    }
    // null userId = system-owned list, admins can access it
  }

  return prisma.contact.findMany({
    where: {
      id: { in: list.contactIds },
      phones: { some: { isDnc: false } },
    },
    include: {
      emails: true,
      phones: { where: { isDnc: false } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function assignContactToListInDb(
  contactId: string,
  listId: string
) {
  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      select: { id: true },
    });
    if (!contact) throwHttp(404, "Contact not found");

    const newList = await tx.contactList.findUnique({
      where: { id: listId },
      select: { id: true, name: true, contactIds: true },
    });
    if (!newList) throwHttp(404, "Target List not found");

    // Remove contact from every other list it currently belongs to
    const currentLists = await tx.contactList.findMany({
      where: { contactIds: { has: contactId } },
      select: { id: true, contactIds: true },
    });
    for (const l of currentLists) {
      if (l.id !== listId) {
        await tx.contactList.update({
          where: { id: l.id },
          data: { contactIds: l.contactIds.filter((id) => id !== contactId) },
        });
      }
    }

    // Add to target list if not already present
    if (!newList.contactIds.includes(contactId)) {
      await tx.contactList.update({
        where: { id: listId },
        data: { contactIds: { push: contactId } },
      });
    }

    return tx.contact.update({
      where: { id: contactId },
      data: { source: newList.name },
      include: { emails: true, phones: true },
    });
  });
}

// ---------------------------------------------------------------------------
// CONTACT FOLDERS
// ---------------------------------------------------------------------------

export async function createContactFolderInDb(
  payload: { name: string; listIds: string[] },
  userId: string
) {
  return prisma.cotactFolder.create({
    data: {
      name: payload.name,
      listIds: payload.listIds,
      userId,
    },
  });
}

export async function updateContactFolderInDb(id: string, payload: {
  name?: string;
  listIds?: string[];
}) {
  return prisma.cotactFolder.update({
    where: { id },
    data: {
      name: payload.name,
      listIds: payload.listIds ? {
        push: payload.listIds,
      } : undefined,
    },
  });
}

export async function createContactGroupInDb(userId: string, payload: {
  name: string;
  contactIds: string[];
}) {
  return prisma.contactGroups.create({
    data: {
      name: payload.name,
      contactIds: payload.contactIds,
      userId,
    },
  });
}


export async function updateContactGroupInDb(id: string, payload: {
  name?: string;
  contactIds?: string[];
}) {
  return prisma.contactGroups.update({
    where: { id },
    data: {
      name: payload.name,
      contactIds: payload.contactIds ? {
        push: payload.contactIds,
      } : undefined,
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
    // Fetch ALL groups visible to this user (owned by them, their pool, or system)
    // so we can correctly add/remove membership
    const allGroups = await tx.contactGroups.findMany({
      where: {
        OR: [{ userId: userId }, { userId: null }],
      },
      select: { id: true, contactIds: true },
    });

    for (const group of allGroups) {
      const isTarget = groupIds.includes(group.id);
      const currentlyMember = group.contactIds.includes(contactId);

      if (isTarget && !currentlyMember) {
        await tx.contactGroups.update({
          where: { id: group.id },
          data: { contactIds: { push: contactId } },
        });
      } else if (!isTarget && currentlyMember) {
        await tx.contactGroups.update({
          where: { id: group.id },
          data: {
            contactIds: group.contactIds.filter((id) => id !== contactId),
          },
        });
      }
    }

    return tx.contact.findUnique({
      where: { id: contactId },
      include: { emails: true, phones: true },
    });
  });
}

// ---------------------------------------------------------------------------
// LEAD SHEET EMAIL
// ---------------------------------------------------------------------------

export async function sendLeadSheetEmailInDb(
  contactId: string,
  leadSheetId: string,
  recipientEmail: string
) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { fullName: true, leadsheetValues: true },
  });
  if (!contact) throwHttp(404, "Contact not found");

  const leadSheet = await prisma.leadSheet.findUnique({
    where: { id: leadSheetId },
    include: { questions: { orderBy: { createdAt: "asc" } } },
  });
  if (!leadSheet) throwHttp(404, "Lead Sheet not found");

  const answers = (contact.leadsheetValues || {}) as Record<string, any>;
  const questionsAndAnswers = leadSheet.questions.map((q) => ({
    text: q.text,
    answer: answers[q.id] ?? null,
  }));

  const html = leadSheetEmailTemp(
    contact.fullName,
    leadSheet.title,
    questionsAndAnswers
  );
  await sendEmail(
    recipientEmail,
    `Lead Sheet: ${leadSheet.title} - ${contact.fullName}`,
    html
  );

  return true;
}

export async function moveToDncInDb(
  contactId: string,
  userId: string,
  phoneIds: string[]
) {
  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      include: { phones: true, emails: true },
    });

    if (!contact) throwHttp(404, "Contact not found");
    const primaryEmail = contact.emails.find(e => e.isPrimary)?.email || contact.emails[0]?.email || null;

    const phonesToMark = contact.phones.filter((p) => phoneIds.includes(p.id));

    if (phonesToMark.length === 0) throwHttp(400, "No valid phone numbers selected");

    // 1. Mark phone numbers as DNC in contact_phones
    await tx.contactPhone.updateMany({
      where: { id: { in: phoneIds } },
      data: { isDnc: true },
    });

    // 2. Add to compliance_dnc table
    const dncEntries = phonesToMark.map((p) => ({
      number: p.number,
      name: contact.fullName,
      email: primaryEmail,
      source: contact.source,
      userId: userId,
    }));

    await tx.compliance_DNC.createMany({
      data: dncEntries,
    });

    // 3. Create Audit Log
    const phoneNumbers = phonesToMark.map(p => p.number).join(", ");
    await tx.auditLog.create({
      data: {
        userId,
        action: `Added ${phoneNumbers} to DNC`,
        details: `Contact: ${contact.fullName}`,
      }
    });

    return { success: true };
  });
}

export async function getDncListFromDb() {
  return prisma.compliance_DNC.findMany({
    orderBy: { createdAt: "desc" },
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

  return prisma.$transaction(
    async (tx) => {
      // 1. Generate IDs and prepare data for bulk insertion
      const contactData = contacts.map((c) => ({
        id: randomUUID(),
        fullName: c.fullName || "Unnamed", 
        city: c.city,
        state: c.state,
        zip: c.zip,
        source: c.source,
        tags: c.tags || [],
        notes: c.notes,
      }));

      const createdContactIds = contactData.map((c) => c.id);

      const emailData = contacts.flatMap((c, index) => {
        const contactId = contactData[index].id;
        return (c.emails || []).map((e: any) => ({
          email: e.email,
          isPrimary: e.isPrimary,
          contactId,
        }));
      });

      const phoneData = contacts.flatMap((c, index) => {
        const contactId = contactData[index].id;
        return (c.phones || []).map((p: any) => ({
          number: p.number,
          type: p.type,
          contactId,
        }));
      });

      // 2. Bulk Insert Contacts
      await tx.contact.createMany({
        data: contactData,
      });

      // 3. Bulk Insert Emails (if any)
      if (emailData.length > 0) {
        await tx.contactEmail.createMany({
          data: emailData,
        });
      }

      // 4. Bulk Insert Phones (if any)
      if (phoneData.length > 0) {
        await tx.contactPhone.createMany({
          data: phoneData,
        });
      }

      // 5. Connect to List or Group
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

      // 6. Record the import
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
    },
    {
      timeout: 60000,
    },
  );
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

export async function exportContactsInDb(args: {
  userId: string;
  fieldNames: string[];
  contactListId?: string;
  contactGroupId?: string;
}) {
  const { userId, fieldNames, contactListId, contactGroupId } = args;

  let exportType: "LIST" | "GROUP" | "ALL_CONTACTS" = "ALL_CONTACTS";
  let contactsCount = 0;

  if (contactListId) {
    exportType = "LIST";
    const list = await prisma.contactList.findUnique({
      where: { id: contactListId },
      select: { contactIds: true },
    });
    if (!list) throwHttp(404, "Contact list not found");
    contactsCount = list.contactIds.length;
  } else if (contactGroupId) {
    exportType = "GROUP";
    const group = await prisma.contactGroups.findUnique({
      where: { id: contactGroupId },
      select: { contactIds: true },
    });
    if (!group) throwHttp(404, "Contact group not found");
    contactsCount = group.contactIds.length;
  } else {
    exportType = "ALL_CONTACTS";
    contactsCount = await prisma.contact.count();
  }

  return prisma.exportContact.create({
    data: {
      userId,
      fieldNames,
      contactListId: contactListId || null,
      contactGroupId: contactGroupId || null,
      contactsCount : contactsCount-1,
      exportType,
    },
    include: {
      user: {
        select: {
          fullName: true,
          email: true,
        },
      },
      contactList: {
        select: { name: true },
      },
      contactGroup: {
        select: { name: true },
      },
    },
  });
}

export async function getAllExportContactsFromDb(userId: string) {
  return prisma.exportContact.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          fullName: true,
          email: true,
          role: true,
        },
      },
      contactList: {
        select: { name: true },
      },
      contactGroup: {
        select: { name: true },
      },
    },
  });
}