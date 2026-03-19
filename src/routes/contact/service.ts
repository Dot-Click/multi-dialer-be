import prisma from "../../lib/prisma";
import { leadSheetEmailTemp, sendEmail } from "../../utils/email";
import path from "path";
import fs from "fs";
import { cloudinaryUploader } from "../../utils/handler";
import { randomUUID } from "crypto";
import { createInternalNotification } from "../notification/controller";


function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Returns the pool of userIds that "belong" to a given admin:
 * the admin themselves + every agent they created.
 */
async function getAdminUserPool(adminId: string): Promise<string[]> {
  const agents = await prisma.user.findMany({
    where: { createdById: adminId },
    select: { id: true },
  });
  return [adminId, ...agents.map((a) => a.id)];
}

// ---------------------------------------------------------------------------
// CONTACTS
// ---------------------------------------------------------------------------

export async function createContactInDb(payload: {
  fullName: string;
  city: string;
  state: string;
  zip: string;
  source: string;
  tags: string[];
  notes: string;
  dataDialerId: string;
  emails: { email: string; isPrimary: boolean }[];
  phones: { number: string; type: any }[];
  contactListId?: string;
  miscValues?: any;
  leadsheetValues?: any;
  userId: string;
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
        notes: payload.notes ?? "",
        miscValues: payload.miscValues ?? {},
        leadsheetValues: payload.leadsheetValues ?? {},
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
        userId: payload.userId,
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

export async function getAllContactsFromDb(userId: string, role: string) {
  // OWNER — sees everything, no filter needed
  if (role === "OWNER") {
    return prisma.contact.findMany({
      where: {
        status: { not: "DO_NOT_CALL" },
      },
      include: {
        emails: true,
        phones: true,
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
          { status: { not: "DO_NOT_CALL" } },
        ],
      },
      include: {
        emails: true,
        phones: true,
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
            OR: [{ id: { in: assignedContactIds } }, { userId: userId }],
          },
          { status: { not: "DO_NOT_CALL" } },
        ],
      },
      include: {
        emails: true,
        phones: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // Fallback — own contacts only
  return prisma.contact.findMany({
    where: {
      userId,
      status: { not: "DO_NOT_CALL" },
    },
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
    notes: string;
    miscValues: any;
    leadsheetValues: any;
    status: string;
    disposition: string;
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
      notes: payload.notes,
      miscValues: payload.miscValues,
      leadsheetValues: payload.leadsheetValues,
      dataDialerId: payload.dataDialerId,
      status: payload.status || payload.disposition,
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

/* BACKUP:
export async function deleteContactFromDb(id: string, userId: string) {
  const existing = await prisma.contact.findUnique({
    where: { id },
    select: { id: true, fullName: true },
  });
  if (!existing) throwHttp(404, "Contact not found");

  await prisma.$transaction(async (tx) => {
    // Scrub contactId from any ContactList.contactIds arrays
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
*/

export async function deleteContactFromDb(id: string, userId: string) {
  // 1. Fetch the full contact data including emails, phones, attachments
  const existing = await prisma.contact.findUnique({
    where: { id },
    include: {
      emails: true,
      phones: true,
      attachments: true,
      miscFields: true,
    },
  });

  if (!existing) throwHttp(404, "Contact not found");

  await prisma.$transaction(async (tx) => {
    // Find all lists this contact belongs to
    const lists = await tx.contactList.findMany({
      where: { contactIds: { has: id } },
      select: { id: true, contactIds: true },
    });
    const contactListIds = lists.map((l) => l.id);

    // Find all groups this contact belongs to
    const groups = await tx.contactGroups.findMany({
      where: { contactIds: { has: id } },
      select: { id: true, contactIds: true },
    });
    const contactGroupIds = groups.map((g) => g.id);

    // 2. Save the complete contact data in the "RestoreContact" table
    // We store it inside an array since the 'contacts' column expects Json for potentially multiple contacts
    const restoredContactData = [
      {
        ...existing,
        contactListId: contactListIds,
        contactGroupId: contactGroupIds,
      },
    ];

    await tx.backupContacts.create({
      data: {
        userId,
        contacts: restoredContactData as any,
      },
    });

    // 3. Scrub contactId from any ContactList.contactIds arrays
    for (const l of lists) {
      await tx.contactList.update({
        where: { id: l.id },
        data: { contactIds: l.contactIds.filter((cid) => cid !== id) },
      });
    }

    // 4. Scrub from ContactGroups as well
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
      },
    });

    // 5. Delete the contact from the Contact table
    await tx.contact.delete({ where: { id } });
  });

  return true;
}

// ---------------------------------------------------------------------------
// ATTACHMENTS
// ---------------------------------------------------------------------------

export async function uploadAttachmentInDb(
  contactId: string,
  file: Express.Multer.File,
) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!contact) throwHttp(404, "Contact not found");

  const filePath = path.join("./uploads", file.filename);
  const cloudinaryResult = await cloudinaryUploader(filePath);

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  if (!cloudinaryResult?.secure_url) {
    throwHttp(500, "Failed to upload to Cloudinary");
  }

  return prisma.attachment.create({
    data: {
      fileName: file.originalname,
      fileUrl: cloudinaryResult.secure_url,
      fileSize: file.size,
      mimeType: file.mimetype,
      contactId,
    },
  });
}

export async function getAttachmentsForContactInDb(contactId: string) {
  return prisma.attachment.findMany({
    where: { contactId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteAttachmentFromDb(attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) throwHttp(404, "Attachment not found");

  return prisma.attachment.delete({ where: { id: attachmentId } });
}

// ---------------------------------------------------------------------------
// CONTACT LISTS
// ---------------------------------------------------------------------------

export async function createContactListInDb(
  payload: { name: string; contactIds: string[] },
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
    agentIds?: string[];
  },
) {
  return prisma.contactList.update({
    where: { id },
    data: {
      name: payload.name,
      // Use `set` so we replace, not append
      contactIds: payload.contactIds ? { set: payload.contactIds } : undefined,
      agentIds: payload.agentIds ? { set: payload.agentIds } : undefined,
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
  role: string,
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
      status: { not: "DO_NOT_CALL" },
    },
    include: {
      emails: true,
      phones: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function assignContactToListInDb(
  contactId: string,
  listId: string,
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
  payload: { name?: string; listIds?: string[] },
) {
  return prisma.cotactFolder.update({
    where: { id },
    data: {
      name: payload.name,
      // FIX: was `push` — should be `set` to replace, not append
      listIds: payload.listIds ? { set: payload.listIds } : undefined,
    },
  });
}

export async function deleteContactFolderFromDb(id: string) {
  return prisma.cotactFolder.delete({ where: { id } });
}

export async function getAllContactFoldersFromDb(
  userId: string,
  role?: string,
) {
  if (role === "OWNER") {
    return prisma.cotactFolder.findMany({ orderBy: { createdAt: "desc" } });
  }

  if (role === "ADMIN") {
    const poolUserIds = await getAdminUserPool(userId);
    return prisma.cotactFolder.findMany({
      where: {
        OR: [{ userId: { in: poolUserIds } }, { userId: null }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (role === "AGENT") {
    // Agents see folders that contain lists they are assigned to
    const assignedLists = await prisma.contactList.findMany({
      where: { agentIds: { has: userId } },
      select: { id: true },
    });
    const listIds = assignedLists.map((l) => l.id);

    return prisma.cotactFolder.findMany({
      where: { listIds: { hasSome: listIds } },
      orderBy: { createdAt: "desc" },
    });
  }

  return prisma.cotactFolder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// CONTACT GROUPS
// ---------------------------------------------------------------------------

export async function createContactGroupInDb(
  userId: string,
  payload: { name: string; contactIds: string[] },
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
  payload: { name?: string; contactIds?: string[] },
) {
  return prisma.contactGroups.update({
    where: { id },
    data: {
      name: payload.name,
      // FIX: was `push` — should be `set` to replace, not append
      contactIds: payload.contactIds ? { set: payload.contactIds } : undefined,
    },
  });
}

export async function deleteContactGroupFromDb(id: string) {
  return prisma.contactGroups.delete({ where: { id } });
}

export async function getAllContactGroupsFromDb(userId: string, role?: string) {
  if (role === "OWNER") {
    return prisma.contactGroups.findMany({ orderBy: { createdAt: "desc" } });
  }

  if (role === "ADMIN") {
    const poolUserIds = await getAdminUserPool(userId);
    return prisma.contactGroups.findMany({
      where: {
        OR: [{ userId: { in: poolUserIds } }, { userId: null }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (role === "AGENT") {
    // Agents see groups created by their admin (identified via createdById)
    // We look up who this agent's admin is first
    const agent = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdById: true },
    });
    const adminId = agent?.createdById;

    return prisma.contactGroups.findMany({
      where: {
        OR: [
          // Groups that include this agent's contacts
          { contactIds: { hasSome: await getAgentContactIds(userId) } },
          // Groups owned by their admin
          ...(adminId ? [{ userId: adminId }] : []),
          // System groups
          { userId: null },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return prisma.contactGroups.findMany({
    where: {
      OR: [{ userId: userId }, { userId: null }],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Small helper to get contact IDs belonging to a specific agent */
async function getAgentContactIds(agentId: string): Promise<string[]> {
  const contacts = await prisma.contact.findMany({
    where: { userId: agentId },
    select: { id: true },
  });
  return contacts.map((c) => c.id);
}

export async function assignAgentsToListInDb(
  listId: string,
  agentIds: string[],
) {
  return prisma.contactList.update({
    where: { id: listId },
    data: { agentIds: { set: agentIds } }, // only touches agentIds, never contactIds
  });
}

export async function assignContactToGroupsInDb(
  contactId: string,
  groupIds: string[],
  userId: string,
) {
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
  recipientEmail: string,
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
    questionsAndAnswers,
  );
  await sendEmail(
    recipientEmail,
    `Lead Sheet: ${leadSheet.title} - ${contact.fullName}`,
    html,
  );

  return true;
}

export async function moveToDncInDb(
  contactId: string,
  userId: string,
  // phoneIds are now ignored as we mark the whole contact
  _phoneIds?: string[],
) {
  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      include: { phones: true, emails: true },
    });

    if (!contact) throwHttp(404, "Contact not found");

    // 1. Mark contact as DO_NOT_CALL
    await tx.contact.update({
      where: { id: contactId },
      data: { status: "DO_NOT_CALL" },
    });

    // 3. Create Audit Log
    const phoneNumbers = contact.phones.map((p) => p.number).join(", ");
    await tx.auditLog.create({
      data: {
        userId,
        action: `Contact marked as DNC`,
        details: `Contact: ${contact.fullName} (${phoneNumbers})`,
      },
    });

    // 4. Send Compliance Alert to Admin/Owner
    try {
      const performer = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, createdById: true, fullName: true }
      });

      if (performer) {
        const adminId = performer.role === 'AGENT' ? performer.createdById : performer.id;

        if (adminId) {
          const adminSettings = await tx.system_Setting.findFirst({
            where: { userId: adminId },
            include: { notificationSetting: true }
          });

          if (adminSettings?.notificationSetting?.complianceAlert) {
            await createInternalNotification(
              adminId,
              `🚫 Compliance Alert: DNC Marked`,
              `${performer.fullName || 'User'} marked ${contact.fullName} (${phoneNumbers}) as Do Not Call.`,
              'error'
            );
          }
        }
      }
    } catch (notifErr) {
      console.error("Failed to send DNC compliance alert:", notifErr);
    }

    return { success: true };
  });
}

export async function getDncListFromDb() {
  return prisma.contact.findMany({
    where: { status: "DO_NOT_CALL" },
    include: { phones: true, emails: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function importContactsFromCsvInDb(args: {
  userId: string;
  fileName: string;
  type: string;
  contactListId?: string;
  contactGroupId?: string;
  keepOld: boolean;
  duplicateConfig?: {
    scope: string[];   // ["Entire Database", "File Import"]
    fields: string[];  // ["Phone", "Emails", "Property Addresses", "Mailing Addresses"]
    handling: string;  // "Keep Old" | "Overwrite" | "Skip"
  };
  contacts: any[];
}) {
  const {
    userId,
    fileName,
    type,
    contactListId,
    contactGroupId,
    keepOld,
    duplicateConfig,
    contacts,
  } = args;

  // ── Normalise duplicate config ──────────────────────────────────────────────

  const dupHandling = duplicateConfig?.handling || (keepOld ? "Keep Old" : "Overwrite");
  const dupFields = duplicateConfig?.fields || [];
  const dupScope = duplicateConfig?.scope || [];

  // Whether we should even run duplicate detection
  const checkDuplicates = dupFields.length > 0 && dupScope.length > 0;

  return prisma.$transaction(
    async (tx) => {

      // ── Step 1: Resolve duplicates ────────────────────────────────────────
      //
      // For each incoming contact we collect its identifying values (phones /
      // emails) and check whether a matching record already exists in the DB.
      //
      // Result buckets:
      //   toInsert  – brand-new contacts that should be created
      //   toUpdate  – existing contacts that should be overwritten (handling === "Overwrite")
      //   toSkip    – contacts that are duplicates and should be dropped

      type IncomingContact = (typeof contacts)[number];

      const toInsert: IncomingContact[] = [];
      const toUpdate: { existingId: string; incoming: IncomingContact }[] = [];

      for (const c of contacts) {
        if (!checkDuplicates) {
          toInsert.push(c);
          continue;
        }

        let existingContact: { id: string } | null = null;

        // ── Check by Phone ──────────────────────────────────────────────────
        if (!existingContact && dupFields.includes("Phone")) {
          const incomingNumbers = (c.phones || []).map((p: any) =>
            p.number?.toString().trim()
          ).filter(Boolean);

          if (incomingNumbers.length > 0) {
            const match = await tx.contactPhone.findFirst({
              where: { number: { in: incomingNumbers } },
              select: { contactId: true },
            });
            if (match) existingContact = { id: match.contactId };
          }
        }

        // ── Check by Email ──────────────────────────────────────────────────
        if (!existingContact && dupFields.includes("Emails")) {
          const incomingEmails = (c.emails || []).map((e: any) =>
            e.email?.toLowerCase().trim()
          ).filter(Boolean);

          if (incomingEmails.length > 0) {
            const match = await tx.contactEmail.findFirst({
              where: { email: { in: incomingEmails } },
              select: { contactId: true },
            });
            if (match) existingContact = { id: match.contactId };
          }
        }

        // ── Check by Property Address (address + city + state + zip) ────────
        if (!existingContact && dupFields.includes("Property Addresses")) {
          if (c.address && c.city && c.state) {
            const match = await tx.contact.findFirst({
              where: {
                address: c.address,
                city: c.city,
                state: c.state,
                zip: c.zip || undefined,
              },
              select: { id: true },
            });
            if (match) existingContact = { id: match.id };
          }
        }

        // ── Check by Mailing Address ────────────────────────────────────────
        if (!existingContact && dupFields.includes("Mailing Addresses")) {
          if (c.mailingAddress && c.mailingCity && c.mailingState) {
            const match = await tx.contact.findFirst({
              where: {
                mailingAddress: c.mailingAddress,
                mailingCity: c.mailingCity,
                mailingState: c.mailingState,
                mailingZip: c.mailingZip || undefined,
              },
              select: { id: true },
            });
            if (match) existingContact = { id: match.id };
          }
        }

        // ── Route to the correct bucket ─────────────────────────────────────
        if (!existingContact) {
          // No match found → always insert
          toInsert.push(c);
        } else if (dupHandling === "Overwrite") {
          toUpdate.push({ existingId: existingContact.id, incoming: c });
        } else {
          // "Keep Old" or "Skip" → drop the incoming record
        }
      }

      // ── Step 2: Bulk-insert new contacts ──────────────────────────────────

      const contactData = toInsert.map((c) => ({
        id: randomUUID(),
        fullName: c.fullName || "Unnamed",
        address: c.address || "",
        city: c.city || "",
        state: c.state || "",
        zip: c.zip || "",
        source: c.source || "CSV Import",
        notes: c.notes || "",
        tags: c.tags || [],
        // Store misc field values as JSON blob (Birthday, Notes from misc, etc.)
        miscValues: c.miscValues ?? null,
        userId,
      }));

      const createdContactIds = contactData.map((c) => c.id);

      if (contactData.length > 0) {
        await tx.contact.createMany({ data: contactData });
      }

      // ── Step 3: Bulk-insert emails & phones for new contacts ──────────────

      const emailData = toInsert.flatMap((c, idx) => {
        const contactId = contactData[idx].id;
        return (c.emails || []).map((e: any) => ({
          email: e.email,
          isPrimary: e.isPrimary ?? false,
          contactId,
        }));
      });

      const phoneData = toInsert.flatMap((c, idx) => {
        const contactId = contactData[idx].id;
        return (c.phones || []).map((p: any) => ({
          number: p.number.toString(),
          type: p.type || "MOBILE",
          contactId,
        }));
      });

      if (emailData.length > 0) {
        await tx.contactEmail.createMany({ data: emailData });
      }

      if (phoneData.length > 0) {
        await tx.contactPhone.createMany({ data: phoneData });
      }

      // ── Step 4: Overwrite existing contacts ───────────────────────────────
      //
      // For "Overwrite" we update the scalar fields and replace phones/emails.
      // We do this individually (not createMany) because we need to delete
      // stale child rows first.

      const updatedContactIds: string[] = [];

      for (const { existingId, incoming } of toUpdate) {
        updatedContactIds.push(existingId);

        // Update scalar fields
        await tx.contact.update({
          where: { id: existingId },
          data: {
            fullName: incoming.fullName || "Unnamed",
            address: incoming.address || "",
            city: incoming.city || "",
            state: incoming.state || "",
            zip: incoming.zip || "",
            source: incoming.source || "CSV Import",
            notes: incoming.notes || "",
            tags: incoming.tags || [],
            miscValues: incoming.miscValues ?? undefined,
          },
        });

        // Replace emails
        if ((incoming.emails || []).length > 0) {
          await tx.contactEmail.deleteMany({ where: { contactId: existingId } });
          await tx.contactEmail.createMany({
            data: (incoming.emails as any[]).map((e) => ({
              email: e.email,
              isPrimary: e.isPrimary ?? false,
              contactId: existingId,
            })),
          });
        }

        // Replace phones
        if ((incoming.phones || []).length > 0) {
          await tx.contactPhone.deleteMany({ where: { contactId: existingId } });
          await tx.contactPhone.createMany({
            data: (incoming.phones as any[]).map((p) => ({
              number: p.number.toString(),
              type: p.type || "MOBILE",
              contactId: existingId,
            })),
          });
        }
      }

      // ── Step 5: Connect contacts to List or Group ─────────────────────────
      //
      // Both new inserts AND overwritten contacts are added to the list/group
      // (if not already present).

      const allContactIds = [...createdContactIds, ...updatedContactIds];

      if (contactListId && allContactIds.length > 0) {
        const list = await tx.contactList.findUnique({
          where: { id: contactListId },
        });
        if (!list) throwHttp(404, "Contact list not found");

        // De-duplicate against existing contactIds on the list
        const existing = new Set(list.contactIds);
        const toAdd = allContactIds.filter((id) => !existing.has(id));

        if (toAdd.length > 0) {
          await tx.contactList.update({
            where: { id: contactListId },
            data: { contactIds: { push: toAdd } },
          });
        }
      } else if (contactGroupId && allContactIds.length > 0) {
        const group = await tx.contactGroups.findUnique({
          where: { id: contactGroupId },
        });
        if (!group) throwHttp(404, "Contact group not found");

        const existing = new Set(group.contactIds);
        const toAdd = allContactIds.filter((id) => !existing.has(id));

        if (toAdd.length > 0) {
          await tx.contactGroups.update({
            where: { id: contactGroupId },
            data: { contactIds: { push: toAdd } },
          });
        }
      }

      // ── Step 6: Record the import ─────────────────────────────────────────

      return tx.importContact.create({
        data: {
          fileName,
          type,
          contactListId,
          contactGroupId,
          keepOld,
          contactsCount: allContactIds.length,
          userId,
        },
      });
    },
    { timeout: 60000 },
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
      contactsCount: contactsCount - 1,
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

export async function getAllBackupContactsFromDb(userId: string, role: string) {
  let backups;

  if (role === "OWNER" || role === "ADMIN") {
    backups = await prisma.backupContacts.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { fullName: true, email: true, role: true } },
      },
    });
  } else {
    backups = await prisma.backupContacts.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { fullName: true, email: true, role: true } },
      },
    });
  }

  // Collect all unique contact list IDs
  const allListIds = new Set<string>();
  for (const backup of backups) {
    if (Array.isArray(backup.contacts)) {
      for (const contact of backup.contacts as any[]) {
        if (Array.isArray(contact.contactlist)) {
          for (const id of contact.contactlist) {
            allListIds.add(id);
          }
        }
        if (Array.isArray(contact.contactListId)) {
          for (const id of contact.contactListId) {
            allListIds.add(id);
          }
        }
      }
    }
  }

  // Fetch the lists
  const lists = await prisma.contactList.findMany({
    where: { id: { in: Array.from(allListIds) } },
    select: { id: true, name: true, createdAt: true },
  });

  const listMap = new Map();
  for (const list of lists) {
    listMap.set(list.id, list);
  }

  // Populate list info
  const populatedBackups = backups.map((backup) => {
    let populatedContacts = backup.contacts;
    if (Array.isArray(backup.contacts)) {
      populatedContacts = (backup.contacts as any[]).map((contact) => {
        const listIds = [
          ...(Array.isArray(contact.contactlist) ? contact.contactlist : []),
          ...(Array.isArray(contact.contactListId)
            ? contact.contactListId
            : []),
        ];

        // Remove duplicates and find the actual lists
        const uniqueListIds = Array.from(new Set(listIds));
        const contactListData = uniqueListIds
          .map((id: string) => listMap.get(id))
          .filter(Boolean);

        return {
          ...contact,
          contactlist: contactListData,
          contactList: contactListData,
        };
      });
    }
    return {
      ...backup,
      contacts: populatedContacts,
    };
  });

  return populatedBackups;
}

export async function restoreContactFromDb(
  originalContactId: string,
  userId: string,
) {
  // Find the backup string that contains this specific contact.
  const allBackups = await prisma.backupContacts.findMany({
    where: { userId },
  });

  let foundBackup = null;
  let foundContactData = null as any;

  for (const backup of allBackups) {
    if (Array.isArray(backup.contacts)) {
      const contact = (backup.contacts as any[]).find(
        (c) => c.id === originalContactId,
      );
      if (contact) {
        foundBackup = backup;
        foundContactData = contact;
        break;
      }
    }
  }

  if (!foundBackup || !foundContactData) {
    throwHttp(404, "Backup contact not found. Unable to restore.");
  }

  await prisma.$transaction(async (tx) => {
    // 1. Restore the base Contact object
    await tx.contact.create({
      data: {
        id: foundContactData.id,
        fullName: foundContactData.fullName,
        address: foundContactData.address,
        city: foundContactData.city,
        state: foundContactData.state,
        zip: foundContactData.zip,
        mailingAddress: foundContactData.mailingAddress,
        mailingCity: foundContactData.mailingCity,
        mailingState: foundContactData.mailingState,
        mailingZip: foundContactData.mailingZip,
        source: foundContactData.source,
        tags: foundContactData.tags || [],
        notes: foundContactData.notes,
        dataDialerId: foundContactData.dataDialerId,
        userId: foundContactData.userId,
        createdAt: foundContactData.createdAt
          ? new Date(foundContactData.createdAt)
          : undefined,
        updatedAt: foundContactData.updatedAt
          ? new Date(foundContactData.updatedAt)
          : undefined,
      },
    });

    // 2. Restore Emails
    if (
      Array.isArray(foundContactData.emails) &&
      foundContactData.emails.length > 0
    ) {
      const emailsData = foundContactData.emails.map((e: any) => ({
        id: e.id,
        email: e.email,
        isPrimary: e.isPrimary,
        contactId: foundContactData.id,
      }));
      await tx.contactEmail.createMany({ data: emailsData });
    }

    // 3. Restore Phones
    if (
      Array.isArray(foundContactData.phones) &&
      foundContactData.phones.length > 0
    ) {
      const phonesData = foundContactData.phones.map((p: any) => ({
        id: p.id,
        number: p.number,
        type: p.type,
        contactId: foundContactData.id,
      }));
      await tx.contactPhone.createMany({ data: phonesData });
    }

    // 4. Restore Attachments
    if (
      Array.isArray(foundContactData.attachments) &&
      foundContactData.attachments.length > 0
    ) {
      const attachmentsData = foundContactData.attachments.map((a: any) => ({
        id: a.id,
        fileName: a.fileName,
        fileUrl: a.fileUrl,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        contactId: foundContactData.id,
        createdAt: a.createdAt ? new Date(a.createdAt) : undefined,
        updatedAt: a.updatedAt ? new Date(a.updatedAt) : undefined,
      }));
      await tx.attachment.createMany({ data: attachmentsData });
    }

    // 5. Restore MiscFields
    await tx.contact.update({
      where: { id: foundContactData.id },
      data: {
        miscValues: foundContactData.miscValues
          ? foundContactData.miscValues
          : undefined,
        leadsheetValues: foundContactData.leadsheetValues
          ? foundContactData.leadsheetValues
          : undefined,
        miscFieldId: foundContactData.miscFieldId,
      },
    });

    // 6. Restore ContactList relationships
    const savedListIds = foundContactData.contactListId || [];
    for (const listId of savedListIds) {
      const exists = await tx.contactList.findUnique({ where: { id: listId } });
      if (exists && !exists.contactIds.includes(foundContactData.id)) {
        await tx.contactList.update({
          where: { id: listId },
          data: { contactIds: { push: foundContactData.id } },
        });
      }
    }

    // 7. Restore ContactGroup relationships
    const savedGroupIds = foundContactData.contactGroupId || [];
    for (const groupId of savedGroupIds) {
      const exists = await tx.contactGroups.findUnique({
        where: { id: groupId },
      });
      if (exists && !exists.contactIds.includes(foundContactData.id)) {
        await tx.contactGroups.update({
          where: { id: groupId },
          data: { contactIds: { push: foundContactData.id } },
        });
      }
    }

    // 8. Delete the specific contact from the BackupContacts entry
    const newContactsArray = (foundBackup.contacts as any[]).filter(
      (c) => c.id !== originalContactId,
    );

    if (newContactsArray.length === 0) {
      await tx.backupContacts.delete({
        where: { id: foundBackup.id },
      });
    } else {
      await tx.backupContacts.update({
        where: { id: foundBackup.id },
        data: { contacts: newContactsArray as any },
      });
    }

    // 9. Create Audit Log
    await tx.auditLog.create({
      data: {
        userId,
        action: `Restored contact: ${foundContactData.fullName}`,
        details: `ID: ${foundContactData.id}`,
      },
    });
  });

  return true;
}

export async function permanentlyDeleteContactFromDb(
  originalContactId: string,
  userId: string,
) {
  // 1. Locate the backup row containing the contact
  const allBackups = await prisma.backupContacts.findMany({
    where: { userId },
  });

  let foundBackup = null;
  let foundContactData = null as any;

  for (const backup of allBackups) {
    if (Array.isArray(backup.contacts)) {
      const contact = (backup.contacts as any[]).find(
        (c) => c.id === originalContactId,
      );
      if (contact) {
        foundBackup = backup;
        foundContactData = contact;
        break;
      }
    }
  }

  if (!foundBackup || !foundContactData) {
    throwHttp(404, "Backup contact not found. Unable to permanently delete.");
  }

  await prisma.$transaction(async (tx) => {
    // 2. Remove the specific contact from the BackupContacts entry
    const newContactsArray = (foundBackup.contacts as any[]).filter(
      (c) => c.id !== originalContactId,
    );

    if (newContactsArray.length === 0) {
      await tx.backupContacts.delete({
        where: { id: foundBackup.id },
      });
    } else {
      await tx.backupContacts.update({
        where: { id: foundBackup.id },
        data: { contacts: newContactsArray as any },
      });
    }

    // 3. Create Audit Log
    await tx.auditLog.create({
      data: {
        userId,
        action: `Permanently deleted contact (no restore possible): ${foundContactData.fullName}`,
        details: `ID: ${foundContactData.id}`,
      },
    });
  });

  return true;
}

// ---------------------------------------------------------------------------
// HOTLIST
// ---------------------------------------------------------------------------

/**
 * Returns the top-10 contacts ranked by total dialing time (desc),
 * with high confidence and positive sentiment from CallAnalysis.
 *
 * - AGENT: only contacts the agent personally called
 * - ADMIN: contacts called by the admin or any of their agents
 * - OWNER: all contacts across the system
 */
export async function getHotlistFromDb(userId: string, role: string) {
  let userIds: string[] = [userId];

  if (role === "OWNER") {
    // All users
    const allUsers = await prisma.user.findMany({ select: { id: true } });
    userIds = allUsers.map((u) => u.id);
  } else if (role === "ADMIN") {
    userIds = await getAdminUserPool(userId);
  }
  // AGENT: just their own userId (default from initialisation)

  // 1. Aggregate total dialing time per contactId from CallRecord
  const callRecords = await prisma.callRecord.findMany({
    where: {
      userId: { in: userIds },
      contactId: { not: null },
      duration: { not: null },
    },
    select: {
      contactId: true,
      duration: true,
      callSid: true,
    },
  });

  // 2. Build a map: contactId -> { totalDuration, callSids[] }
  const contactMap = new Map<
    string,
    { totalDuration: number; callSids: string[] }
  >();

  for (const record of callRecords) {
    if (!record.contactId) continue;
    const existing = contactMap.get(record.contactId);
    if (existing) {
      existing.totalDuration += record.duration ?? 0;
      existing.callSids.push(record.callSid);
    } else {
      contactMap.set(record.contactId, {
        totalDuration: record.duration ?? 0,
        callSids: [record.callSid],
      });
    }
  }

  if (contactMap.size === 0) return [];

  // 3. Enrich with sentiment/confidence from CallAnalysis
  const allCallSids = Array.from(contactMap.values()).flatMap(
    (v) => v.callSids,
  );

  const analyses = await prisma.callAnalysis.findMany({
    where: { callSid: { in: allCallSids } },
    select: { callSid: true, sentiment: true, confidence: true },
  });

  // Map callSid -> analysis
  const analysisMap = new Map(
    analyses.map((a) => [a.callSid, a]),
  );

  // 4. Compute per-contact: avg confidence, dominant sentiment
  type EnrichedContact = {
    contactId: string;
    totalDuration: number;
    avgConfidence: number;
    sentiment: string;
  };

  const enriched: EnrichedContact[] = [];

  for (const [contactId, { totalDuration, callSids }] of contactMap) {
    const relatedAnalyses = callSids
      .map((sid) => analysisMap.get(sid))
      .filter(Boolean) as { callSid: string; sentiment: string; confidence: number }[];

    const avgConfidence =
      relatedAnalyses.length > 0
        ? relatedAnalyses.reduce((acc, a) => acc + a.confidence, 0) /
        relatedAnalyses.length
        : 0;

    // Dominant sentiment (most frequent)
    const sentimentCounts: Record<string, number> = {};
    for (const a of relatedAnalyses) {
      sentimentCounts[a.sentiment] = (sentimentCounts[a.sentiment] ?? 0) + 1;
    }
    const sentiment =
      Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "neutral";

    enriched.push({ contactId, totalDuration, avgConfidence, sentiment });
  }

  // 5. Filter: high confidence (>= 0.6) and positive/neutral sentiment
  const filtered = enriched.filter(
    (e) =>
      e.avgConfidence >= 0.6 &&
      (e.sentiment === "positive" || e.sentiment === "neutral"),
  );

  // If not enough filtered results, fall back to all enriched contacts
  const ranked = (filtered.length >= 3 ? filtered : enriched)
    .sort((a, b) => b.totalDuration - a.totalDuration)
    .slice(0, 10);

  // 6. Fetch actual contact details
  const contactIds = ranked.map((r) => r.contactId);

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    include: {
      phones: { take: 1 },
      emails: { where: { isPrimary: true }, take: 1 },
    },
  });

  // 7. Merge and preserve rank order
  const contactDetailMap = new Map(contacts.map((c) => [c.id, c]));

  return ranked
    .map((r) => {
      const contact = contactDetailMap.get(r.contactId);
      if (!contact) return null;
      return {
        id: contact.id,
        fullName: contact.fullName,
        phone: contact.phones[0]?.number ?? null,
        totalDialingTime: r.totalDuration,
        avgConfidence: r.avgConfidence,
        sentiment: r.sentiment,
      };
    })
    .filter(Boolean);
}

export async function sendTemplateEmailInDb(contactId: string, templateId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { emails: { where: { isPrimary: true } } },
  });
  if (!contact) throwHttp(404, "Contact not found");

  const email = contact.emails[0]?.email;
  if (!email) throwHttp(400, "Contact has no primary email");

  const template = await prisma.emailTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template) throwHttp(404, "Email template not found");

  // Simple placeholder replacement logic
  let content = template.content;
  content = content.replace(/{{fullName}}/g, contact.fullName || "Friend");
  content = content.replace(/{{city}}/g, contact.city || "");

  await sendEmail(email, template.subject, content);

  return true;
}

export async function scheduleTemplateEmailInDb(contactId: string, templateId: string, scheduledAt: string) {
  // Since we don't have a background worker set up in this demo, 
  // we'll just log it to the console and return success.
  // In a real app, you'd insert into a 'ScheduledEmails' table or a Bull queue.
  console.log(`[SCHEDULED] Email template ${templateId} to contact ${contactId} at ${scheduledAt}`);
  return true;
}
