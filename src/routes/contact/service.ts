import { PhoneType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { leadSheetEmailTemp, sendEmail } from "../../utils/email";
import { uploadToR2, getPresignedUrlFromStoredUrl } from "../../utils/r2-uploader";
import { randomUUID } from "crypto";
import { createInternalNotification } from "../notification/controller";
import { resolveTenantUserIds, resolveTenantRootId } from "../../utils/tenant";
import { resolveCompanyContext } from "../../utils/resolveCompany";
import { startOfTodayInTimezone } from "../../utils/timezone";
import { ActionPlanService } from "../systemSettings/actionplan/service";
import { tombstoneMplContacts } from "../../services/mplTombstone.service";


function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

// ---------------------------------------------------------------------------
// ZILLOW PROPERTY LINK
// ---------------------------------------------------------------------------
//
// This deliberately does NOT call the RapidAPI Zillow scraper.
//
// That provider's /bylocation endpoint is a *market search*, not an address
// lookup: it expects a city/region slug (its own example is "seattle-wa")
// together with listType/price/beds/sqft filters, and it returns homes that
// are currently listed for sale. Handing it a full street address made it
// fall back to a town-wide search, and the ranking pass below it then
// returned the top-scoring row even when the street address had not matched
// at all — city + state + zip alone were enough to win. That is why
// "7 Hazelwood Pl, Huntington, NY 11743" opened
// "23 Renwick Ave, Huntington, NY 11743": right town, wrong house.
//
// It could not have worked in general even with better ranking. Dialer
// contacts are overwhelmingly owner-occupants whose homes are NOT for sale,
// so they never appear in a for-sale search at all.
//
// Zillow's own canonical search path resolves a full address to that
// property's page — listed or off-market — and redirects to
// /homedetails/<slug>/<zpid>_zpid/. It is deterministic, costs nothing, has
// no rate limit (the old path was returning 429s), and structurally cannot
// return a different house than the one asked for.
const ZILLOW_SEARCH_BASE_URL = "https://www.zillow.com/homes";

function buildZillowPropertyUrl(addressQuery: string): string {
  // Zillow's slug is the address with spaces as hyphens, comma separators
  // kept. Percent-encode first so unit markers ("#C", "Apt 2", "Unit 4B")
  // and any other reserved character survive, then swap the encoded spaces
  // for the hyphens Zillow expects.
  const slug = encodeURIComponent(addressQuery.replace(/\s+/g, " ").trim())
    .replace(/%20/g, "-");

  return `${ZILLOW_SEARCH_BASE_URL}/${slug}_rb/`;
}

function buildContactAddress(contact: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  return [contact.address, contact.city, contact.state, contact.zip]
    .filter(Boolean)
    .join(", ")
    .trim();
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
  address: string;
  city: string;
  state: string;
  zip: string;
  mailingAddress: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  source: string;
  tags: string[];
  notes: string[];
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
        address: payload.address,
        city: payload.city,
        state: payload.state,
        zip: payload.zip,
        mailingAddress: payload.mailingAddress,
        mailingCity: payload.mailingCity,
        mailingState: payload.mailingState,
        mailingZip: payload.mailingZip,
        source: payload.source,
        tags: payload.tags ?? [],
        notes: payload.notes ?? [],
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
        callRecords: {
          orderBy: { startTime: "desc" },
          take: 1,
          select: { startTime: true },
        },
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

export async function getAllContactsFromDb(userId: string, role: string, page: number, limit: number) {
  const skip = (page - 1) * limit;
  const include = {
    emails: true,
    phones: true,
    callRecords: {
      orderBy: { startTime: "desc" as const },
      take: 1,
      select: { startTime: true },
    },
  };

  // OWNER — sees everything, no filter needed
  if (role === "OWNER") {
    const where = { status: { not: "DO_NOT_CALL" as const } };
    const [data, total] = await prisma.$transaction([
      prisma.contact.findMany({ where, include, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.contact.count({ where }),
    ]);
    return { data, total };
  }

  // ADMIN — sees contacts owned by themselves or any of their agents,
  // plus any contacts that appear in lists they own.
  if (role === "ADMIN") {
    const poolUserIds = await getAdminUserPool(userId);
    const myLists = await prisma.contactList.findMany({
      where: { OR: [{ userId: { in: poolUserIds } }, { userId: null }] },
      select: { contactIds: true },
    });
    const listContactIds = [...new Set(myLists.flatMap((l) => l.contactIds))];
    const where = {
      AND: [
        { OR: [{ userId: { in: poolUserIds } }, { id: { in: listContactIds } }] },
        { status: { not: "DO_NOT_CALL" as const } },
      ],
    };
    const [data, total] = await prisma.$transaction([
      prisma.contact.findMany({ where, include, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.contact.count({ where }),
    ]);
    return { data, total };
  }

  // AGENT — sees:
  //   1. Contacts that live inside lists their admin assigned them to
  //   2. Contacts they personally created (userId === agent's id)
  if (role === "AGENT") {
    const assignedLists = await prisma.contactList.findMany({
      where: { agentIds: { has: userId } },
      select: { contactIds: true },
    });
    const assignedContactIds = [...new Set(assignedLists.flatMap((l) => l.contactIds))];
    const where = {
      AND: [
        { OR: [{ id: { in: assignedContactIds } }, { userId }] },
        { status: { not: "DO_NOT_CALL" as const } },
      ],
    };
    const [data, total] = await prisma.$transaction([
      prisma.contact.findMany({ where, include, orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.contact.count({ where }),
    ]);
    return { data, total };
  }

  // Fallback — own contacts only
  const where = { userId, status: { not: "DO_NOT_CALL" as const } };
  const [data, total] = await prisma.$transaction([
    prisma.contact.findMany({ where, include, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.contact.count({ where }),
  ]);
  return { data, total };
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
          callerId: { select: { twillioNumber: true, label: true } },
        },
        orderBy: { startTime: "desc" },
      },
      emailLogs: { select: { id: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      smsLogs: { select: { id: true } },
      user: { select: { fullName: true, companies: { select: { defaultTimeZone: true }, take: 1 } } },
    },
  });
  if (!contact) throwHttp(404, "Contact not found");

  // Recording URLs are stored as the private R2 S3 endpoint, which a browser
  // cannot play. Swap each into a short-lived presigned URL so the <audio>
  // player can stream it directly (same helper the recordings report uses).
  if (contact.callRecords?.length) {
    await Promise.all(
      contact.callRecords.map(async (cr: any) => {
        if (cr.recordingUrl) {
          cr.recordingUrl = await getPresignedUrlFromStoredUrl(cr.recordingUrl);
        }
      }),
    );
  }

  return contact;
}

export async function getZillowLinkForContactInDb(contactId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      fullName: true,
      address: true,
      city: true,
      state: true,
      zip: true,
    },
  });

  if (!contact) {
    throwHttp(404, "Contact not found");
  }

  const addressQuery = buildContactAddress(contact);

  if (!contact.address?.trim()) {
    throwHttp(400, "Contact does not have a property address");
  }

  // A street line on its own does not place the property — Zillow would land
  // on a disambiguation page for whichever "7 Hazelwood Pl" it guesses first.
  // Require a ZIP, or a city and state, before handing back a link.
  const hasZip = !!contact.zip?.trim();
  const hasCityAndState = !!contact.city?.trim() && !!contact.state?.trim();

  if (!hasZip && !hasCityAndState) {
    throwHttp(
      400,
      "Property address needs a ZIP code, or a city and state, to identify this home on Zillow",
    );
  }

  const zillowUrl = buildZillowPropertyUrl(addressQuery);
  console.log(`[Zillow] contact ${contact.id}: ${addressQuery} -> ${zillowUrl}`);

  return {
    contactId: contact.id,
    addressQuery,
    zillowUrl,
  };
}

export async function addContactNoteInDb(id: string, note: string) {
  return prisma.contact.update({
    where: { id },
    data: {
      notes: { push: note }
    },
    include: {
      emails: true,
      phones: true,
    }
  });
}

export async function updateContactInDb(
  id: string,
  payload: Partial<{
    fullName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    mailingAddress: string;
    mailingCity: string;
    mailingState: string;
    mailingZip: string;
    source: string;
    tags: string[];
    dataDialerId: string | null;
    emails: { email: string; isPrimary: boolean }[];
    phones: { number: string; type: any; isPrimary?: boolean; isBestNumber?: boolean }[];
    notes: string[];
    description: string;
    agentRemarks: string;
    miscValues: any;
    leadsheetValues: any;
    status: string;
    disposition: string;
    permission: boolean;
    want: boolean;
    why: boolean;
    statusQuo: boolean;
    timeline: boolean;
    agent: boolean;
    folderIds: string[];
  }>,
  userId: string,
) {
  const existing = await prisma.contact.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throwHttp(404, "Contact not found");

  const newStatus = payload.status;
  let folderIdsUpdate = undefined;

  // If moving to DNC, ensure we have the folder ID and push it
  if (newStatus === "DO_NOT_CALL") {
    const dncFolder = await ensureDncFolder(userId);
    if (dncFolder) {
      folderIdsUpdate = { push: dncFolder.id };
    }
  } else if (payload.folderIds) {
    folderIdsUpdate = payload.folderIds;
  }

  return prisma.contact.update({
    where: { id },
    data: {
      fullName: payload.fullName,
      address: payload.address,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      mailingAddress: payload.mailingAddress,
      mailingCity: payload.mailingCity,
      mailingState: payload.mailingState,
      mailingZip: payload.mailingZip,
      source: payload.source,
      tags: payload.tags,
      notes: payload.notes,
      description: payload.description,
      agentRemarks: payload.agentRemarks,
      miscValues: payload.miscValues,
      leadsheetValues: payload.leadsheetValues,
      permission: payload.permission,
      want: payload.want,
      why: payload.why,
      statusQuo: payload.statusQuo,
      timeline: payload.timeline,
      agent: payload.agent,
      dataDialerId: payload.dataDialerId,
      status: newStatus,
      disposition: payload.disposition,
      folderIds: folderIdsUpdate,
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
            isBestNumber: p.isBestNumber ?? false,
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
    await Promise.all(lists.map((l) => tx.contactList.update({
      where: { id: l.id },
      data: { contactIds: l.contactIds.filter((cid) => cid !== id) },
    })));

    // 4. Scrub from ContactGroups as well
    await Promise.all(groups.map((g) => tx.contactGroups.update({
      where: { id: g.id },
      data: { contactIds: g.contactIds.filter((cid) => cid !== id) },
    })));

    // Create Audit Log
    await tx.auditLog.create({
      data: {
        userId,
        action: `Deleted contact: ${existing.fullName}`,
        details: `ID: ${id}`,
      },
    });

    // 5. Tombstone if this was an MPL-tagged import, so the sync does not
    //    re-create it on the next cron run.
    await tombstoneMplContacts(tx, [id]);

    // 6. Delete the contact from the Contact table
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

  if (!file.buffer) {
    throwHttp(400, "File buffer is required");
  }

  const r2Result = await uploadToR2(file.buffer, file.mimetype, "attachments");

  return prisma.attachment.create({
    data: {
      fileName: file.originalname,
      fileUrl: r2Result.url,
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
  payload: { name: string; contactIds: string[]; folderId?: string; parentId?: string },
  userId: string,
) {
  // Enforce single-level sub-lists: a sub-list cannot itself have a parent.
  if (payload.parentId) {
    const parent = await prisma.contactList.findUnique({
      where: { id: payload.parentId },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      throwHttp(404, "Parent list not found");
    }
    if (parent!.parentId) {
      throwHttp(400, "Sub-lists can only be nested one level deep");
    }
  }

  return prisma.contactList.create({
    data: {
      name: payload.name,
      contactIds: payload.contactIds,
      folderId: payload.folderId,
      parentId: payload.parentId,
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
    folderId?: string;
  },
) {
  return prisma.contactList.update({
    where: { id },
    data: {
      name: payload.name,
      contactIds: payload.contactIds ? { set: payload.contactIds } : undefined,
      agentIds: payload.agentIds ? { set: payload.agentIds } : undefined,
      folderId: payload.folderId,
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
      callRecords: {
        orderBy: { startTime: "desc" },
        take: 1,
        select: { startTime: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getContactsByFolderFromDb(
  folderId: string,
  userId: string,
  role: string,
) {
  const folder = await prisma.contactFolder.findUnique({
    where: { id: folderId },
    select: { userId: true, isSystem: true, name: true },
  });
  if (!folder) throwHttp(404, "Folder not found");

  const isDncFolder = folder.isSystem && folder.name === "Do Not Call";

  // ADMIN: folder must belong to them or one of their agents
  if (role === "ADMIN") {
    if (folder.userId !== null) {
      const poolUserIds = await getAdminUserPool(userId);
      if (!poolUserIds.includes(folder.userId)) {
        throwHttp(403, "Access denied to this folder");
      }
    }
  }

  // AGENT: folder must belong to them (folders aren't currently "assigned" to agents in the same way lists are)
  if (role === "AGENT") {
    if (folder.userId !== userId) {
      throwHttp(403, "Access denied to this folder");
    }
  }

  return prisma.contact.findMany({
    where: {
      folderIds: { has: folderId },
      // If it's NOT the DNC folder, hide DNC contacts. 
      // If it IS the DNC folder, we ONLY want DNC contacts (or at least definitely want to see them).
      ...(isDncFolder ? { status: "DO_NOT_CALL" } : { status: { not: "DO_NOT_CALL" } }),
    },
    include: {
      emails: true,
      phones: true,
      callRecords: {
        orderBy: { startTime: "desc" },
        take: 1,
        select: { startTime: true },
      },
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

export async function ensureDncFolder(userId: string, tx?: any) {
  const client = tx || prisma;
  try {
    const dncFolder = await client.contactFolder.findFirst({
      where: {
        userId,
        isSystem: true,
        name: "Do Not Call"
      }
    });

    if (!dncFolder) {
      const newFolder = await client.contactFolder.create({
        data: {
          name: "Do Not Call",
          isSystem: true,
          userId,
          listIds: [],
          contactIds: []
        }
      });
      console.log(`[ContactService] Initialized DNC system folder for user ${userId}`);
      return newFolder;
    }
    return dncFolder;
  } catch (error) {
    console.error(`[ContactService] Failed to ensure DNC folder for ${userId}:`, error);
    return null;
  }
}

export async function ensureTrashFolder(userId: string, tx?: any) {
  const client = tx || prisma;
  try {
    const trashFolder = await client.contactFolder.findFirst({
      where: {
        userId,
        isSystem: true,
        name: "Trash"
      }
    });

    if (!trashFolder) {
      const newFolder = await client.contactFolder.create({
        data: {
          name: "Trash",
          isSystem: true,
          userId,
          listIds: [],
          contactIds: []
        }
      });
      console.log(`[ContactService] Initialized Trash system folder for user ${userId}`);
      return newFolder;
    }
    return trashFolder;
  } catch (error) {
    console.error(`[ContactService] Failed to ensure Trash folder for ${userId}:`, error);
    return null;
  }
}

/**
 * Moves contacts into the account's system "Trash" folder — the same
 * treatment applyDisposition() gives contacts tagged with the protected
 * "Trash" disposition (systemSettings/dispositions/service.ts): removed from
 * every list, folderIds set to just the Trash folder. Reversible (move to a
 * different folder/list later), unlike deleteContactFromDb's hard delete.
 * This is what the "Delete"/"Delete Selected" buttons use by default now —
 * QA found neither actually moved anything to Trash before this.
 */
export async function moveContactsToTrash(contactIds: string[], userId: string, tx?: any): Promise<string | null> {
  const client = tx || prisma;
  if (contactIds.length === 0) return null;

  // Trash is scoped to the admin/tenant, same resolution dispositions'
  // getDispositions() uses — an agent's deleted contacts land in their
  // admin's Trash folder, not a separate per-agent one.
  const performer = await client.user.findUnique({
    where: { id: userId },
    select: { role: true, createdById: true },
  });
  const adminId = (performer?.role === "AGENT" && performer.createdById) ? performer.createdById : userId;

  const trashFolder = await ensureTrashFolder(adminId, tx);
  if (!trashFolder) throwHttp(500, "Failed to resolve Trash folder");

  const lists = await client.contactList.findMany({
    where: { contactIds: { hasSome: contactIds } },
    select: { id: true, contactIds: true },
  });
  await Promise.all(lists.map((l: any) => client.contactList.update({
    where: { id: l.id },
    data: { contactIds: l.contactIds.filter((id: string) => !contactIds.includes(id)) },
  })));

  await client.contact.updateMany({
    where: { id: { in: contactIds } },
    data: { folderIds: [trashFolder.id] },
  });

  return trashFolder.id;
}

export async function createContactFolderInDb(
  payload: { name: string; listIds: string[]; contactIds?: string[]; parentId?: string },
  userId: string,
) {
  return prisma.contactFolder.create({
    data: {
      name: payload.name,
      isSystem: false, // User created folders are never system
      listIds: payload.listIds,
      contactIds: payload.contactIds,
      parentId: payload.parentId,
      userId,
    },
  });
}

export async function updateContactFolderInDb(
  id: string,
  payload: { name?: string; listIds?: string[]; contactIds?: string[]; parentId?: string },
) {
  return prisma.contactFolder.update({
    where: { id },
    data: {
      name: payload.name,
      listIds: payload.listIds ? { set: payload.listIds } : undefined,
      contactIds: payload.contactIds ? { set: payload.contactIds } : undefined,
      parentId: payload.parentId,
    },
  });
}

export async function deleteContactFolderFromDb(id: string) {
  const folder = await prisma.contactFolder.findUnique({
    where: { id },
    select: { isSystem: true }
  });

  if (folder?.isSystem) {
    throwHttp(403, "System folders cannot be deleted");
  }

  return prisma.contactFolder.delete({ where: { id } });
}

export async function getAllContactFoldersFromDb(
  userId: string,
  role?: string,
) {
  if (role === "OWNER") {
    return prisma.contactFolder.findMany({ orderBy: { createdAt: "desc" } });
  }

  if (role === "ADMIN") {
    const poolUserIds = await getAdminUserPool(userId);
    return prisma.contactFolder.findMany({
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

    return prisma.contactFolder.findMany({
      where: {
        OR: [
          { listIds: { hasSome: listIds } },
          { userId: userId } // Agents also see every folder they personally own (system or not)
        ]
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return prisma.contactFolder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function assignContactToFolderInDb(
  contactId: string,
  folderId: string | null,
  mode: "add" | "replace" = "add"
) {
  if (!folderId) {
    return prisma.contact.update({
      where: { id: contactId },
      data: { folderIds: [] },
    });
  }

  if (mode === "replace") {
    return prisma.contact.update({
      where: { id: contactId },
      data: { folderIds: [folderId] },
    });
  }

  // ADD mode: fetch existing and push if not present
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { folderIds: true }
  });

  if (!contact) throwHttp(404, "Contact not found");

  const newFolderIds = Array.from(new Set([...contact.folderIds, folderId]));

  return prisma.contact.update({
    where: { id: contactId },
    data: { folderIds: newFolderIds },
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
  userId: string,
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
  const { companyId, agentEmail } = await resolveCompanyContext(userId);
  await sendEmail(
    recipientEmail,
    `Lead Sheet: ${leadSheet.title} - ${contact.fullName}`,
    html,
    { userId, contactId, companyId, replyToEmail: agentEmail }
  );

  return true;
}

export async function moveToDncInDb(
  contactId: string,
  userId: string,
  // phoneIds are now ignored as we mark the whole contact
  _phoneIds?: string[],
) {
  // Resolve to the tenant's admin id (not the acting user's) so an agent
  // marking a contact DNC lands it in the ONE shared tenant-level DNC folder
  // the admin can see — not a folder scoped to the agent's own userId.
  // Resolved BEFORE the transaction starts: it uses the top-level `prisma`
  // client (a separate DB connection), and calling that from inside an
  // interactive transaction fights the transaction for a pool connection —
  // easily blowing past Prisma's default 5s transaction timeout and throwing
  // "Transaction already closed" on whatever runs next inside `tx`.
  const tenantRootId = await resolveTenantRootId(userId);

  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      include: { phones: true, emails: true },
    });

    if (!contact) throwHttp(404, "Contact not found");

    // 1. Mark contact as DO_NOT_CALL, remove it from every list (out of the
    //    session/dial queue), and place it in the system DNC folder.
    const dncFolder = await ensureDncFolder(tenantRootId, tx);

    const lists = await tx.contactList.findMany({
      where: { contactIds: { has: contactId } },
      select: { id: true, contactIds: true },
    });
    for (const l of lists) {
      await tx.contactList.update({
        where: { id: l.id },
        data: { contactIds: l.contactIds.filter((id) => id !== contactId) },
      });
    }

    // Flag all of the contact's numbers as DNC so none can be dialed.
    await tx.contactPhone.updateMany({
      where: { contactId },
      data: { isDnc: true },
    });

    await tx.contact.update({
      where: { id: contactId },
      data: {
        status: "DO_NOT_CALL",
        folderIds: dncFolder ? [dncFolder.id] : [],
      },
    });

    // 2b. A contact moved to DNC — by any path, since they all funnel through
    // here — should stop receiving any active Action Plan (no more drip
    // emails, follow-up call/task reminders, etc.).
    await ActionPlanService.stopActivePlansForContact(contactId, tx);

    // 3. Create Audit Log
    const phoneNumbers = contact.phones.map((p) => p.number).join(", ");
    await tx.auditLog.create({
      data: {
        userId,
        action: `Contact marked as DNC`,
        details: `Contact: ${contact.fullName} (${phoneNumbers})`,
      },
    });

    return { success: true, folderId: dncFolder?.id ?? null, fullName: contact.fullName, phoneNumbers };
  }).then(async (result) => {
    // 4. Send Compliance Alert to Admin/Owner — best-effort, run AFTER the
    // transaction commits. createInternalNotification writes via the
    // top-level `prisma` client and makes a push-notification network call;
    // doing that from inside the transaction fought it for a pool connection
    // and could blow past Prisma's 5s transaction timeout ("Transaction
    // already closed"). None of this is required for the DNC mark itself.
    try {
      const performer = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, createdById: true, fullName: true }
      });

      if (performer) {
        const adminId = performer.role === 'AGENT' ? performer.createdById : performer.id;

        if (adminId) {
          const adminSettings = await prisma.system_Setting.findFirst({
            where: { userId: adminId },
            include: { notificationSetting: true }
          });

          if (adminSettings?.notificationSetting?.complianceAlert) {
            await createInternalNotification(
              adminId,
              `🚫 Compliance Alert: DNC Marked`,
              `${performer.fullName || 'User'} marked ${result.fullName} (${result.phoneNumbers}) as Do Not Call.`,
              'error'
            );
          }
        }
      }
    } catch (notifErr) {
      console.error("Failed to send DNC compliance alert:", notifErr);
    }

    return { success: result.success, folderId: result.folderId };
  });
}

export async function removeFromDncInDb(contactId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      select: { id: true, fullName: true },
    });

    if (!contact) throwHttp(404, "Contact not found");

    // 1. Reset contact status (setting to PENDING allows it to be dialed again)
    await tx.contact.update({
      where: { id: contactId },
      data: { status: "PENDING" },
    });

    // 2. Create Audit Log
    await tx.auditLog.create({
      data: {
        userId,
        action: `Contact removed from DNC`,
        details: `Contact: ${contact.fullName}`,
      },
    });

    return { success: true };
  });
}

export async function bulkAssignContactsToListInDb(
  contactIds: string[],
  listId: string,
) {
  if (!contactIds || contactIds.length === 0) {
    return { success: true, listName: "" };
  }
  const movedSet = new Set(contactIds);

  return prisma.$transaction(async (tx) => {
    const newList = await tx.contactList.findUnique({
      where: { id: listId },
      select: { id: true, name: true, contactIds: true },
    });
    if (!newList) throwHttp(404, "Target List not found");

    // Remove ALL moved contacts from every OTHER list, ONE sequential update per
    // list. The previous version looped per-contact with Promise.all and read
    // each list's array concurrently — under production DB latency those reads
    // overlapped and the last write (built from a stale array) dropped the other
    // removals, leaving contacts in their old list (the "duplicate" bug).
    const otherLists = await tx.contactList.findMany({
      where: { id: { not: listId }, contactIds: { hasSome: contactIds } },
      select: { id: true, contactIds: true },
    });
    for (const l of otherLists) {
      await tx.contactList.update({
        where: { id: l.id },
        data: { contactIds: l.contactIds.filter((id) => !movedSet.has(id)) },
      });
    }

    // Add all moved contacts to the target list (deduped), in one update.
    const mergedTarget = Array.from(new Set([...newList.contactIds, ...contactIds]));
    await tx.contactList.update({
      where: { id: listId },
      data: { contactIds: mergedTarget },
    });

    // Stamp the source on the moved contacts.
    await tx.contact.updateMany({
      where: { id: { in: contactIds } },
      data: { source: newList.name },
    });

    return { success: true, listName: newList.name };
  });
}

export async function bulkMoveToDncInDb(
  contactIds: string[],
  userId: string,
) {
  // Use a longer timeout for bulk operations to prevent 'Transaction already closed' errors
  return prisma.$transaction(async (tx) => {
    const contacts = await tx.contact.findMany({
      where: { id: { in: contactIds } },
      include: { phones: true },
    });

    // Pass the transaction client 'tx' to ensureDncFolder
    const dncFolder = await ensureDncFolder(userId, tx);

    await Promise.all(contacts.map(async (contact) => {
      // 1. Mark contact as DO_NOT_CALL and move to DNC folder
      await tx.contact.update({
        where: { id: contact.id },
        data: {
          status: "DO_NOT_CALL",
          folderIds: { push: dncFolder?.id || undefined }
        },
      });

      // 2. Clear from any lists (This ensures DNC contacts don't stay in active lists)
      const contactLists = await tx.contactList.findMany({
        where: { contactIds: { has: contact.id } },
        select: { id: true, contactIds: true }
      });

      await Promise.all(contactLists.map((list) => tx.contactList.update({
        where: { id: list.id },
        data: {
          contactIds: list.contactIds.filter(id => id !== contact.id)
        }
      })));

      // 3. Create Audit Log
      const phoneNumbers = contact.phones.map((p) => p.number).join(", ");
      await tx.auditLog.create({
        data: {
          userId,
          action: `Contact marked as DNC (Bulk)`,
          details: `Contact: ${contact.fullName} (${phoneNumbers})`,
        },
      });
    }));

    // 4. Send Compliance Alert to Admin/Owner (just one alert for bulk action)
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
              `🚫 Compliance Alert: Bulk DNC Marked`,
              `${performer.fullName || 'User'} marked ${contacts.length} contacts as Do Not Call.`,
              'error'
            );
          }
        }
      }
    } catch (notifErr) {
      console.error("Failed to send DNC compliance alert (non-fatal):", notifErr);
    }

    return { success: true };
  }, {
    timeout: 20000 // 20 seconds
  });
}

export async function getDncListFromDb(
  userId: string,
  page = 1,
  pageSize = 10,
) {
  // Scope to the caller's tenant (admin + their agents) so each user only sees
  // the contacts THEY (their tenant) marked as DNC — never the whole system.
  // OWNER (null) sees everything.
  const tenantUserIds = await resolveTenantUserIds(userId);

  const where = {
    status: "DO_NOT_CALL" as const,
    ...(tenantUserIds === null ? {} : { userId: { in: tenantUserIds } }),
  };

  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));

  const [items, total] = await prisma.$transaction([
    prisma.contact.findMany({
      where,
      include: { phones: true, emails: true },
      orderBy: { updatedAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function importContactsInDb(args: {
  userId: string;
  fileName: string;
  type: string;
  contactListId?: string;
  contactGroupId?: string;
  contactFolderId?: string;
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
    contactFolderId,
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

  type IncomingContact = (typeof contacts)[number];

  // ── Step 1: Resolve duplicates (BULK, OUTSIDE the transaction) ────────────
  //
  // Previously this ran a `findFirst` per contact INSIDE the transaction. For
  // large imports (1000+ rows) the sequential round-trips blew past the
  // transaction timeout → "Transaction already closed". We now run a handful of
  // bulk lookups up-front, scoped to the importing user's pool, and classify
  // each contact in memory. Only the writes happen inside the transaction.
  //
  // Result buckets:
  //   toInsert – brand-new contacts to create
  //   toUpdate – existing contacts to overwrite (handling === "Overwrite")
  //   (skipped) – duplicates dropped under "Keep Old"/"Skip"

  const toInsert: IncomingContact[] = [];
  const toUpdate: { existingId: string; incoming: IncomingContact }[] = [];

  // Only values that actually look like phone numbers (≥ 7 digits) are valid
  // dedupe keys — protects against junk like "Y"/"N" DNC flags or ids.
  const validNumbers = (c: IncomingContact): string[] =>
    (c.phones || [])
      .map((p: any) => p.number?.toString().trim())
      .filter((n: string) => !!n && n.replace(/\D/g, "").length >= 7);
  const validEmails = (c: IncomingContact): string[] =>
    (c.emails || [])
      .map((e: any) => e.email?.toString().toLowerCase().trim())
      .filter(Boolean);
  const addrKey = (a?: string | null, c?: string | null, s?: string | null, z?: string | null) =>
    [a, c, s, z].map((x) => (x || "").trim().toLowerCase()).join("|");

  if (!checkDuplicates) {
    toInsert.push(...contacts);
  } else {
    // Scope duplicate detection to the importing user's pool (self + agents),
    // NOT the whole database (which previously matched other tenants' data).
    const poolUserIds = await getAdminUserPool(userId);

    const phoneOwner = new Map<string, string>(); // number -> contactId
    const emailOwner = new Map<string, string>(); // email  -> contactId
    const propOwner = new Map<string, string>();  // addrKey -> contactId
    const mailOwner = new Map<string, string>();

    if (dupFields.includes("Phone")) {
      const allNumbers = [...new Set(contacts.flatMap(validNumbers))];
      if (allNumbers.length > 0) {
        const rows = await prisma.contactPhone.findMany({
          where: { number: { in: allNumbers }, contact: { userId: { in: poolUserIds } } },
          select: { number: true, contactId: true },
        });
        for (const r of rows) if (!phoneOwner.has(r.number)) phoneOwner.set(r.number, r.contactId);
      }
    }

    if (dupFields.includes("Emails")) {
      const allEmails = [...new Set(contacts.flatMap(validEmails))];
      if (allEmails.length > 0) {
        const rows = await prisma.contactEmail.findMany({
          where: { email: { in: allEmails }, contact: { userId: { in: poolUserIds } } },
          select: { email: true, contactId: true },
        });
        for (const r of rows) {
          const k = r.email.toLowerCase();
          if (!emailOwner.has(k)) emailOwner.set(k, r.contactId);
        }
      }
    }

    if (dupFields.includes("Property Addresses")) {
      const addrs = [...new Set(contacts.map((c) => c.address).filter(Boolean))];
      if (addrs.length > 0) {
        const rows = await prisma.contact.findMany({
          where: { userId: { in: poolUserIds }, address: { in: addrs } },
          select: { id: true, address: true, city: true, state: true, zip: true },
        });
        for (const r of rows) {
          const k = addrKey(r.address, r.city, r.state, r.zip);
          if (!propOwner.has(k)) propOwner.set(k, r.id);
        }
      }
    }

    if (dupFields.includes("Mailing Addresses")) {
      const addrs = [...new Set(contacts.map((c) => c.mailingAddress).filter(Boolean))];
      if (addrs.length > 0) {
        const rows = await prisma.contact.findMany({
          where: { userId: { in: poolUserIds }, mailingAddress: { in: addrs } },
          select: { id: true, mailingAddress: true, mailingCity: true, mailingState: true, mailingZip: true },
        });
        for (const r of rows) {
          const k = addrKey(r.mailingAddress, r.mailingCity, r.mailingState, r.mailingZip);
          if (!mailOwner.has(k)) mailOwner.set(k, r.id);
        }
      }
    }

    for (const c of contacts) {
      let existingId: string | null = null;

      if (!existingId && dupFields.includes("Phone")) {
        for (const n of validNumbers(c)) { if (phoneOwner.has(n)) { existingId = phoneOwner.get(n)!; break; } }
      }
      if (!existingId && dupFields.includes("Emails")) {
        for (const e of validEmails(c)) { if (emailOwner.has(e)) { existingId = emailOwner.get(e)!; break; } }
      }
      if (!existingId && dupFields.includes("Property Addresses") && c.address && c.city && c.state) {
        const k = addrKey(c.address, c.city, c.state, c.zip);
        if (propOwner.has(k)) existingId = propOwner.get(k)!;
      }
      if (!existingId && dupFields.includes("Mailing Addresses") && c.mailingAddress && c.mailingCity && c.mailingState) {
        const k = addrKey(c.mailingAddress, c.mailingCity, c.mailingState, c.mailingZip);
        if (mailOwner.has(k)) existingId = mailOwner.get(k)!;
      }

      if (!existingId) toInsert.push(c);
      else if (dupHandling === "Overwrite") toUpdate.push({ existingId, incoming: c });
      // else "Keep Old" / "Skip" → drop the incoming record
    }
  }

  const importRecord = await prisma.$transaction(
    async (tx) => {

      // ── Step 2: Bulk-insert new contacts ──────────────────────────────────

      const contactData = toInsert.map((c) => ({
        id: randomUUID(),
        fullName: c.fullName || "Unnamed",
        address: c.address || "",
        city: c.city || "",
        state: c.state || "",
        zip: c.zip || "",
        mailingAddress: c.mailingAddress || null,
        mailingAddress2: c.mailingAddress2 || null,
        mailingCity: c.mailingCity || null,
        mailingState: c.mailingState || null,
        mailingZip: c.mailingZip || null,
        source: c.source || "CSV Import",
        notes: [],
        description: c.description ? String(c.description) : (c.notes ? (Array.isArray(c.notes) ? c.notes.join("\n") : String(c.notes)) : null),
        agentRemarks: null,
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
            mailingAddress: incoming.mailingAddress || null,
            mailingAddress2: incoming.mailingAddress2 || null,
            mailingCity: incoming.mailingCity || null,
            mailingState: incoming.mailingState || null,
            mailingZip: incoming.mailingZip || null,
            source: incoming.source || "CSV Import",
            notes: undefined, // never overwrite agent/Slingvo notes on import
            description: incoming.description ? String(incoming.description) : (incoming.notes ? (Array.isArray(incoming.notes) ? incoming.notes.join("\n") : String(incoming.notes)) : undefined),
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
      } else if (contactFolderId && allContactIds.length > 0) {
        const folder = await tx.contactFolder.findUnique({
          where: { id: contactFolderId },
        });
        if (!folder) throwHttp(404, "Contact folder not found");

        const existing = new Set(folder.contactIds);
        const toAdd = allContactIds.filter((id) => !existing.has(id));

        if (toAdd.length > 0) {
          await tx.contactFolder.update({
            where: { id: contactFolderId },
            data: { contactIds: { push: toAdd } },
          });
        }

        // Also update individual contacts with this folderId
        for (const cid of allContactIds) {
          const contact = await tx.contact.findUnique({ where: { id: cid }, select: { folderIds: true } });
          if (contact && !contact.folderIds.includes(contactFolderId)) {
            await tx.contact.update({
              where: { id: cid },
              data: { folderIds: { push: contactFolderId } },
            });
          }
        }
      }

      // ── Step 6: Record the import ─────────────────────────────────────────

      return tx.importContact.create({
        data: {
          fileName,
          type,
          contactListId,
          contactGroupId,
          contactFolderId,
          keepOld,
          contactsCount: allContactIds.length,
          userId,
        },
      });
    },
    { timeout: 120000 },
  );

  // Surface what actually happened so the UI never shows a silent "success"
  // when everything was skipped as a duplicate.
  return {
    ...importRecord,
    inserted: toInsert.length,
    updated: toUpdate.length,
    skipped: contacts.length - toInsert.length - toUpdate.length,
  };
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
      contactFolder: {
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
  contactFolderId?: string;
}) {
  const { userId, fieldNames, contactListId, contactGroupId, contactFolderId } = args;

  let exportType: "LIST" | "GROUP" | "FOLDER" | "ALL_CONTACTS" = "ALL_CONTACTS";
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
  } else if (contactFolderId) {
    exportType = "FOLDER";
    const folder = await prisma.contactFolder.findUnique({
      where: { id: contactFolderId },
      select: { contactIds: true },
    });
    if (!folder) throwHttp(404, "Contact folder not found");
    contactsCount = folder.contactIds.length;
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
      contactFolderId: contactFolderId || null,
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
      contactFolder: {
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
      contactFolder: {
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
 * Returns today's contacts marked with the "Lead" disposition — the protected
 * default disposition seeded for every tenant (Disposition.value === "LEAD").
 * The list resets itself daily: it only ever includes ContactDispositionLog
 * rows created since local midnight in the fixed CST/CDT timezone, so
 * yesterday's leads naturally drop out with no cleanup job required.
 *
 * - AGENT: only leads they personally marked
 * - ADMIN: leads marked by the admin or any of their agents
 * - OWNER: all leads marked across the system
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

  const startOfToday = startOfTodayInTimezone("America/Chicago");

  const logs = await prisma.contactDispositionLog.findMany({
    where: {
      appliedById: { in: userIds },
      createdAt: { gte: startOfToday },
      disposition: { value: "LEAD" },
    },
    include: {
      contact: {
        include: {
          phones: { take: 1 },
          emails: { where: { isPrimary: true }, take: 1 },
        },
      },
      appliedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // One row per contact — if marked Lead more than once today, keep the most
  // recent (logs are already ordered desc, so the first occurrence wins).
  const seenContactIds = new Set<string>();
  const deduped = logs.filter((log) => {
    if (seenContactIds.has(log.contactId)) return false;
    seenContactIds.add(log.contactId);
    return true;
  });

  return deduped.map((log) => ({
    id: log.contact.id,
    fullName: log.contact.fullName,
    phone: log.contact.phones[0]?.number ?? null,
    markedAt: log.createdAt,
    markedBy: log.appliedBy?.fullName ?? null,
  }));
}

// Replaces {{token}} merge fields with the contact's data. Used for both subject and body.
export function applyMergeFields(text: string, contact: any): string {
  if (!text) return text;
  const fullName = contact.fullName || "";
  const firstName = fullName.trim().split(/\s+/)[0] || "";
  const lastName = fullName.trim().split(/\s+/).slice(1).join(" ") || "";
  const primaryEmail =
    contact.emails?.find((e: any) => e.isPrimary)?.email ||
    contact.emails?.[0]?.email ||
    "";
  const primaryPhone =
    contact.phones?.find((p: any) => p.isPrimary)?.number ||
    contact.phones?.[0]?.number ||
    "";

  const map: Record<string, string> = {
    fullName,
    firstName,
    lastName,
    address: contact.address || "",
    city: contact.city || "",
    state: contact.state || "",
    zip: contact.zip || "",
    email: primaryEmail,
    phone: primaryPhone,
    agentName: contact.user?.fullName || "",
  };

  return text.replace(/{{\s*(\w+)\s*}}/g, (full, key) =>
    key in map ? map[key] : full
  );
}

export async function sendTemplateEmailInDb(contactId: string, templateId: string, userId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      emails: true,
      phones: true,
      user: { select: { fullName: true } },
    },
  });
  if (!contact) throwHttp(404, "Contact not found");

  const email =
    contact.emails.find((e) => e.isPrimary)?.email || contact.emails[0]?.email;
  if (!email) throwHttp(400, "Contact has no primary email");

  const template = await prisma.emailTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template) throwHttp(404, "Email template not found");

  // Read includeSignature via raw SQL (Prisma client may not be regenerated yet)
  const flagRows = await prisma.$queryRaw<{ includeSignature: boolean }[]>`
    SELECT "includeSignature" FROM email_templates WHERE id = ${templateId}
  `;
  const includeSignature = flagRows[0]?.includeSignature ?? false;

  const subject = applyMergeFields(template.subject, contact);
  let content = applyMergeFields(template.content, contact);

  if (includeSignature) {
    const signature = await prisma.signature.findUnique({ where: { userId } });
    if (signature?.content) {
      content += `<br/><br/>${signature.content}`;
    }
  }

  const { companyId, agentEmail } = await resolveCompanyContext(userId);
  await sendEmail(email, subject, content, { userId, contactId, templateId, includeUnsubscribe: true, companyId, replyToEmail: agentEmail });

  return true;
}

export async function sendFreeformEmailInDb(contactId: string, userId: string, subject: string, html: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { emails: true },
  });
  if (!contact) throwHttp(404, "Contact not found");

  const email = contact.emails.find((e) => e.isPrimary)?.email || contact.emails[0]?.email;
  if (!email) throwHttp(400, "Contact has no email address");

  const { companyId, agentEmail } = await resolveCompanyContext(userId);
  await sendEmail(email, subject, html, { userId, contactId, companyId, replyToEmail: agentEmail });

  return true;
}

export async function scheduleTemplateEmailInDb(contactId: string, templateId: string, scheduledAt: string) {
  // Since we don't have a background worker set up in this demo, 
  // we'll just log it to the console and return success.
  // In a real app, you'd insert into a 'ScheduledEmails' table or a Bull queue.
  console.log(`[SCHEDULED] Email template ${templateId} to contact ${contactId} at ${scheduledAt}`);
  return true;
}
export const getDuplicateContactsFromDb = async (userId: string, listId?: string, folderId?: string) => {
  // Scope duplicate detection to the caller's tenant (self + their agents).
  // OWNER gets `null` back, meaning "no scoping, see everything".
  const tenantUserIds = await resolveTenantUserIds(userId);
  const tenantFilter = tenantUserIds ? { userId: { in: tenantUserIds } } : {};

  // When called from within a specific list or folder, narrow detection to
  // just that container's members instead of the whole tenant.
  let scopeFilter: { id?: { in: string[] } } = {};
  if (listId) {
    const list = await prisma.contactList.findUnique({
      where: { id: listId },
      select: { contactIds: true },
    });
    if (!list) throwHttp(404, "List not found");
    scopeFilter = { id: { in: list.contactIds } };
  } else if (folderId) {
    const folder = await prisma.contactFolder.findUnique({
      where: { id: folderId },
      select: { contactIds: true },
    });
    if (!folder) throwHttp(404, "Folder not found");
    scopeFilter = { id: { in: folder.contactIds } };
  }
  const contactFilter = { ...tenantFilter, ...scopeFilter };

  // ── 1. Find Duplicate identifiers ───────────────────────────────

  // A. Phones
  const dupPhones = await prisma.contactPhone.groupBy({
    by: ['number'],
    _count: { number: true },
    having: { number: { _count: { gt: 1 } } },
    where: { contact: contactFilter },
  });
  const dupPhoneNumbers = dupPhones.map((p) => p.number);

  // B. Emails
  const dupEmailsRaw = await prisma.contactEmail.groupBy({
    by: ['email'],
    _count: { email: true },
    having: { email: { _count: { gt: 1 } } },
    where: { contact: contactFilter },
  });
  const dupEmailAddresses = dupEmailsRaw.map((e) => e.email);

  // C. Property Addresses
  // CSV imports store a missing address as "" rather than null (see importContactsInDb),
  // so blank fields must be excluded alongside null — otherwise every no-address contact
  // groups into one bucket and gets falsely flagged as a duplicate.
  const dupPropAddresses = await prisma.contact.groupBy({
    by: ['address', 'city', 'state', 'zip'],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
    where: {
      NOT: [{ address: null }, { address: "" }, { city: null }, { city: "" }, { state: null }, { state: "" }],
      ...contactFilter,
    }
  });

  // D. Mailing Addresses
  const dupMailAddresses = await prisma.contact.groupBy({
    by: ['mailingAddress', 'mailingCity', 'mailingState', 'mailingZip'],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
    where: {
      NOT: [{ mailingAddress: null }, { mailingAddress: "" }, { mailingCity: null }, { mailingCity: "" }, { mailingState: null }, { mailingState: "" }],
      ...contactFilter,
    }
  });

  // ── 2. Fetch All Contacts with Duplicates ──────────────────────────
  const contacts = await prisma.contact.findMany({
    where: {
      ...contactFilter,
      OR: [
        { phones: { some: { number: { in: dupPhoneNumbers } } } },
        { emails: { some: { email: { in: dupEmailAddresses } } } },
        {
          OR: dupPropAddresses.map(addr => ({
            address: addr.address,
            city: addr.city,
            state: addr.state,
            zip: addr.zip
          }))
        },
        {
          OR: dupMailAddresses.map(addr => ({
            mailingAddress: addr.mailingAddress,
            mailingCity: addr.mailingCity,
            mailingState: addr.mailingState,
            mailingZip: addr.mailingZip
          }))
        }
      ].filter(cond => {
        if (Array.isArray((cond as any).OR) && (cond as any).OR.length === 0) return false;
        return true;
      }) as any
    },
    include: {
      phones: true,
      emails: true,
      callRecords: {
        orderBy: { startTime: 'desc' },
        take: 1,
        select: { startTime: true },
      },
    },
    orderBy: {
      fullName: 'asc',
    },
  });

  // ── 2.5 Fetch Context Metadata (Folders and Lists) ────────────────
  const allFolderIdsForContacts = Array.from(new Set(contacts.flatMap(c => c.folderIds)));
  const contactIdsFound = contacts.map(c => c.id);

  const [foldersFound, listsFound] = await Promise.all([
    prisma.contactFolder.findMany({
      where: { id: { in: allFolderIdsForContacts } },
      select: { id: true, name: true }
    }),
    prisma.contactList.findMany({
      where: { contactIds: { hasSome: contactIdsFound } },
      select: { id: true, name: true, contactIds: true }
    })
  ]);

  // ── 3. Tag with Reason and Locations ───────────────────────────────────────────
  const tagged = contacts.map(c => {
    const reasons: string[] = [];
    if (c.phones.some(p => dupPhoneNumbers.includes(p.number))) reasons.push("Phone Match");
    if (c.emails.some(e => dupEmailAddresses.includes(e.email))) reasons.push("Email Match");

    const isPropDup = dupPropAddresses.some(addr =>
      addr.address === c.address && addr.city === c.city && addr.state === c.state && addr.zip === c.zip
    );
    if (isPropDup) reasons.push("Property Address Match");

    const isMailDup = dupMailAddresses.some(addr =>
      addr.mailingAddress === c.mailingAddress && addr.mailingCity === c.mailingCity && addr.mailingState === c.mailingState && addr.mailingZip === c.mailingZip
    );
    if (isMailDup) reasons.push("Mailing Address Match");

    // Map Folder names
    const folderNames = foldersFound
      .filter(f => c.folderIds.includes(f.id))
      .map(f => f.name);

    // Map List names
    const listNames = listsFound
      .filter(l => l.contactIds.includes(c.id))
      .map(l => l.name);

    return {
      ...c,
      duplicateReason: reasons.join(", "),
      locationContext: [...folderNames.map(n => `Folder: ${n}`), ...listNames.map(n => `List: ${n}`)].join(", "),
      folderNames,
      listNames,
    };
  });

  // ── 4. Group matched contacts into clusters (union-find) so the pairs/
  // groups that actually match each other come back ADJACENT in the list,
  // instead of scattered across an alphabetically-sorted flat array. Two
  // contacts are unioned into the same cluster whenever they share a
  // flagged phone, email, property address, or mailing address — and this
  // is transitive (A↔B by phone, B↔C by address ⇒ A, B, C are one cluster),
  // so the whole "family" of a duplicate ends up grouped together, not just
  // exact pairs. This is what makes it possible for the frontend to render
  // matches "coupled right near one another."
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined) {
      parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const unionBySharedKey = (keyFn: (c: (typeof tagged)[number]) => string | null) => {
    const byKey = new Map<string, string[]>();
    for (const c of tagged) {
      const key = keyFn(c);
      if (!key) continue;
      const ids = byKey.get(key) ?? [];
      ids.push(c.id);
      byKey.set(key, ids);
    }
    for (const ids of byKey.values()) {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    }
  };

  unionBySharedKey(c => {
    const match = c.phones.find(p => dupPhoneNumbers.includes(p.number));
    return match ? `phone:${match.number}` : null;
  });
  unionBySharedKey(c => {
    const match = c.emails.find(e => dupEmailAddresses.includes(e.email));
    return match ? `email:${match.email}` : null;
  });
  unionBySharedKey(c =>
    dupPropAddresses.some(addr => addr.address === c.address && addr.city === c.city && addr.state === c.state && addr.zip === c.zip)
      ? `propAddr:${c.address}|${c.city}|${c.state}|${c.zip}`
      : null
  );
  unionBySharedKey(c =>
    dupMailAddresses.some(addr => addr.mailingAddress === c.mailingAddress && addr.mailingCity === c.mailingCity && addr.mailingState === c.mailingState && addr.mailingZip === c.mailingZip)
      ? `mailAddr:${c.mailingAddress}|${c.mailingCity}|${c.mailingState}|${c.mailingZip}`
      : null
  );

  const grouped = tagged.map(c => ({ ...c, duplicateGroupId: find(c.id) }));

  // Cluster size (for a "Group of N" badge) and a stable per-cluster sort
  // key (earliest fullName in the cluster) so clusters are ordered
  // predictably and every member of a cluster lands on consecutive rows.
  const groupSizes = new Map<string, number>();
  const groupSortKey = new Map<string, string>();
  for (const c of grouped) {
    groupSizes.set(c.duplicateGroupId, (groupSizes.get(c.duplicateGroupId) ?? 0) + 1);
    const name = (c.fullName || "").toLowerCase();
    const existing = groupSortKey.get(c.duplicateGroupId);
    if (existing === undefined || name < existing) groupSortKey.set(c.duplicateGroupId, name);
  }

  return grouped
    .map(c => ({ ...c, duplicateGroupSize: groupSizes.get(c.duplicateGroupId) ?? 1 }))
    .sort((a, b) => {
      const groupCompare = groupSortKey.get(a.duplicateGroupId)!.localeCompare(groupSortKey.get(b.duplicateGroupId)!);
      if (groupCompare !== 0) return groupCompare;
      if (a.duplicateGroupId !== b.duplicateGroupId) return a.duplicateGroupId.localeCompare(b.duplicateGroupId);
      return (a.fullName || "").toLowerCase().localeCompare((b.fullName || "").toLowerCase());
    });
};

// ---------------------------------------------------------------------------
// BULK OPERATIONS
// ---------------------------------------------------------------------------

/**
 * High-performance bulk deletion and isolation.
 * 
 * If context (folderId or listId) is provided, it performs a 'Contextual Removal'
 * which keeps the contact in the system but removes it from that specific container.
 * 
 * If hardDelete is true, it performs a global purge with optimized batching.
 */
export async function bulkDeleteContactsInDb(
  userId: string,
  contactIds: string[],
  options: {
    folderId?: string;
    listId?: string;
    hardDelete?: boolean
  } = {}
) {
  const { folderId, listId, hardDelete } = options;

  // Use a transaction for consistency and performance
  return prisma.$transaction(async (tx) => {

    // Shared by Cases 1 & 2: once a contact would have zero remaining
    // list/folder homes, unlinking it just makes it an invisible orphan
    // (still in the DB, unreachable from any view) — purge it for real
    // instead, same backup+scrub path as the explicit hard-delete case.
    const purgeOrphans = async (ids: string[], reason: string) => {
      if (ids.length === 0) return;

      const contactsToPurge = await tx.contact.findMany({
        where: { id: { in: ids } },
        include: { emails: true, phones: true, attachments: true }
      });
      if (contactsToPurge.length === 0) return;

      await tx.backupContacts.create({
        data: { userId, contacts: contactsToPurge as any }
      });

      const listsToScrub = await tx.contactList.findMany({
        where: { contactIds: { hasSome: ids } },
        select: { id: true, contactIds: true }
      });
      await Promise.all(listsToScrub.map((l) => tx.contactList.update({
        where: { id: l.id },
        data: { contactIds: l.contactIds.filter(id => !ids.includes(id)) }
      })));

      const groupsToScrub = await tx.contactGroups.findMany({
        where: { contactIds: { hasSome: ids } },
        select: { id: true, contactIds: true }
      });
      await Promise.all(groupsToScrub.map((g) => tx.contactGroups.update({
        where: { id: g.id },
        data: { contactIds: g.contactIds.filter(id => !ids.includes(id)) }
      })));

      await tombstoneMplContacts(tx, ids);
      await tx.contact.deleteMany({ where: { id: { in: ids } } });

      await tx.auditLog.create({
        data: {
          userId,
          action: `Bulk hard deleted ${ids.length} orphaned contacts`,
          details: `Reason: ${reason}. IDs: ${ids.slice(0, 5).join(', ')}...`
        }
      });
    };

    // ── CASE 1: Contextual Removal from Folder ──────────────────────────────────
    if (folderId && !hardDelete) {
      // 1. Fetch contacts and remove the specific folderId from their arrays
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds }, folderIds: { has: folderId } },
        select: { id: true, folderIds: true }
      });
      const ids = contacts.map(c => c.id);

      // List membership isn't mirrored on Contact, so check from the list
      // side: is any of these contacts still referenced by ANY list?
      const listsWithAny = await tx.contactList.findMany({
        where: { contactIds: { hasSome: ids } },
        select: { contactIds: true }
      });
      const inAnyList = new Set<string>();
      listsWithAny.forEach(l => l.contactIds.forEach(id => { if (ids.includes(id)) inAnyList.add(id); }));

      const toUnlink = contacts.filter(c =>
        c.folderIds.filter(id => id !== folderId).length > 0 || inAnyList.has(c.id)
      );
      const toPurge = contacts.filter(c => !toUnlink.includes(c)).map(c => c.id);

      await Promise.all(toUnlink.map((contact) => tx.contact.update({
        where: { id: contact.id },
        data: {
          folderIds: contact.folderIds.filter(id => id !== folderId)
        }
      })));

      // 2. Clear from folder.contactIds array as well
      const folder = await tx.contactFolder.findUnique({
        where: { id: folderId },
        select: { id: true, contactIds: true }
      });
      if (folder) {
        await tx.contactFolder.update({
          where: { id: folderId },
          data: {
            contactIds: folder.contactIds.filter(id => !ids.includes(id))
          }
        });
      }

      if (toUnlink.length > 0) {
        await tx.auditLog.create({
          data: {
            userId,
            action: `Bulk removed ${toUnlink.length} contacts from folder`,
            details: `Folder ID: ${folderId}`
          }
        });
      }

      await purgeOrphans(toPurge, `only home was folder ${folderId}`);

      return { success: true, count: ids.length, mode: 'removed_from_folder', purged: toPurge.length };
    }

    // ── CASE 2: Contextual Removal from List ────────────────────────────────────
    if (listId && !hardDelete) {
      const list = await tx.contactList.findUnique({
        where: { id: listId },
        select: { id: true, contactIds: true }
      });

      // Only the requested contacts that are actually in this list.
      const ids = list ? contactIds.filter(id => list.contactIds.includes(id)) : [];

      const contacts = await tx.contact.findMany({
        where: { id: { in: ids } },
        select: { id: true, folderIds: true }
      });

      const otherLists = await tx.contactList.findMany({
        where: { id: { not: listId }, contactIds: { hasSome: ids } },
        select: { contactIds: true }
      });
      const inOtherList = new Set<string>();
      otherLists.forEach(l => l.contactIds.forEach(id => { if (ids.includes(id)) inOtherList.add(id); }));

      const toPurge = contacts
        .filter(c => c.folderIds.length === 0 && !inOtherList.has(c.id))
        .map(c => c.id);
      const toUnlinkCount = ids.length - toPurge.length;

      if (list) {
        await tx.contactList.update({
          where: { id: listId },
          data: {
            contactIds: list.contactIds.filter(id => !ids.includes(id))
          }
        });
      }

      if (toUnlinkCount > 0) {
        await tx.auditLog.create({
          data: {
            userId,
            action: `Bulk removed ${toUnlinkCount} contacts from list`,
            details: `List ID: ${listId}`
          }
        });
      }

      await purgeOrphans(toPurge, `only home was list ${listId}`);

      return { success: true, count: ids.length, mode: 'removed_from_list', purged: toPurge.length };
    }

    // ── CASE 3: Hard Delete or Move to Trash ────────────────────────────────────
    if (!hardDelete) {
      // No folderId/listId in context (e.g. deleting from "All Contacts") —
      // move to the Trash folder instead of just clearing folderIds. QA
      // finding: the old "safe-unassign" here left the contact fully live
      // and queryable, so it silently reappeared on the next refetch even
      // though Redux had optimistically removed it from view.
      const trashFolderId = await moveContactsToTrash(contactIds, userId, tx);

      await tx.auditLog.create({
        data: {
          userId,
          action: `Bulk moved ${contactIds.length} contacts to Trash`,
        }
      });

      return { success: true, count: contactIds.length, mode: 'moved_to_trash', folderId: trashFolderId };
    }

    // ── CASE 4: Explicit Hard Delete (Global Purge) ──────────────────────────────
    // 1. Fetch contacts for backup
    const contactsToPurge = await tx.contact.findMany({
      where: { id: { in: contactIds } },
      include: { emails: true, phones: true, attachments: true }
    });

    // 2. Perform single bulk backup
    await tx.backupContacts.create({
      data: {
        userId,
        contacts: contactsToPurge as any
      }
    });

    // 3. Batch scrub from ALL lists that contain any of these contacts
    const listsToScrub = await tx.contactList.findMany({
      where: { contactIds: { hasSome: contactIds } },
      select: { id: true, contactIds: true }
    });

    await Promise.all(listsToScrub.map((l) => tx.contactList.update({
      where: { id: l.id },
      data: {
        contactIds: l.contactIds.filter(id => !contactIds.includes(id))
      }
    })));

    // 4. Batch scrub from ALL groups as well
    const groupsToScrub = await tx.contactGroups.findMany({
      where: { contactIds: { hasSome: contactIds } },
      select: { id: true, contactIds: true }
    });

    await Promise.all(groupsToScrub.map((g) => tx.contactGroups.update({
      where: { id: g.id },
      data: {
        contactIds: g.contactIds.filter(id => !contactIds.includes(id))
      }
    })));

    // 5. Delete all contact records
    await tombstoneMplContacts(tx, contactIds);
    await tx.contact.deleteMany({
      where: { id: { in: contactIds } }
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: `Bulk hard deleted ${contactIds.length} contacts`,
        details: `IDs: ${contactIds.slice(0, 5).join(', ')}...`
      }
    });

    return { success: true, count: contactIds.length, mode: 'hard_delete' };

  }, {
    timeout: 30000 // 30 seconds for massive batches
  });
}

export async function bulkAssignContactsToFolderInDb(
  contactIds: string[],
  folderId: string,
  mode: "add" | "replace" = "add"
) {
  return prisma.$transaction(async (tx) => {
    if (mode === "replace") {
      // MOVE: each contact ends up in EXACTLY the target folder.
      await tx.contact.updateMany({
        where: { id: { in: contactIds } },
        data: { folderIds: [folderId] }
      });

      // Strip the moved contacts out of every OTHER folder's contactIds mirror
      // so the source folder (e.g. Expired) no longer lists them — otherwise the
      // contacts appear in both folders (duplicate) in views/reports that read
      // the mirror array.
      const otherFolders = await tx.contactFolder.findMany({
        where: { id: { not: folderId }, contactIds: { hasSome: contactIds } },
        select: { id: true, contactIds: true },
      });
      await Promise.all(otherFolders.map((f) =>
        tx.contactFolder.update({
          where: { id: f.id },
          data: { contactIds: f.contactIds.filter((id) => !contactIds.includes(id)) },
        })
      ));

      // Also remove the moved contacts from every LIST they belong to. Moving a
      // contact INTO a folder relocates it out of lists entirely — otherwise it
      // stays visible in its old list as well (a copy, not a move).
      const sourceLists = await tx.contactList.findMany({
        where: { contactIds: { hasSome: contactIds } },
        select: { id: true, contactIds: true },
      });
      await Promise.all(sourceLists.map((l) =>
        tx.contactList.update({
          where: { id: l.id },
          data: { contactIds: l.contactIds.filter((id) => !contactIds.includes(id)) },
        })
      ));
    } else {
      // ADD mode: requires per-contact update because updateMany doesn't support array push
      await Promise.all(contactIds.map(async (id) => {
        const contact = await tx.contact.findUnique({
          where: { id },
          select: { folderIds: true }
        });
        if (contact) {
          const freshFolderIds = Array.from(new Set([...contact.folderIds, folderId]));
          await tx.contact.update({
            where: { id },
            data: { folderIds: freshFolderIds }
          });
        }
      }));
    }

    // Sync redundant folder.contactIds array
    const folder = await tx.contactFolder.findUnique({
      where: { id: folderId },
      select: { contactIds: true }
    });

    if (folder) {
      const mergedIds = Array.from(new Set([...folder.contactIds, ...contactIds]));
      await tx.contactFolder.update({
        where: { id: folderId },
        data: { contactIds: mergedIds }
      });
    }

    return { success: true };
  }, {
    timeout: 20000
  });
}

/**
 * Merges multiple duplicate contacts into a single Master contact.
 * Aggregates unique phones, emails, tags, and notes.
 * Re-links call records and attachments to the master contact.
 */
export async function mergeContactsInDb(
  userId: string,
  masterId: string,
  duplicateIds: string[],
  targetFolderId: string,
  targetListId: string
) {
  return prisma.$transaction(async (tx) => {
    // 1. Fetch all involved contacts
    const allIds = [masterId, ...duplicateIds];
    const contacts = await tx.contact.findMany({
      where: { id: { in: allIds } },
      include: {
        emails: true,
        phones: true,
        attachments: true,
        callRecords: true,
      }
    });

    const master = contacts.find(c => c.id === masterId);
    if (!master) throwHttp(404, "Master contact not found");

    const duplicates = contacts.filter(c => c.id !== masterId);
    if (duplicates.length === 0) return master;

    // 1.5 Guard: only merge contacts that actually match the master on at
    // least one identifier. The duplicates table lists every contact flagged
    // as a duplicate of ANYONE, not just the master — without this check, a
    // careless multi-select (e.g. "select all") would silently fold totally
    // unrelated contacts into one record.
    const normalizeAddress = (c: (typeof contacts)[number]) =>
      c.address && c.city && c.state
        ? `${c.address}|${c.city}|${c.state}|${c.zip || ""}`.toLowerCase()
        : null;
    const normalizeMailingAddress = (c: (typeof contacts)[number]) =>
      c.mailingAddress && c.mailingCity && c.mailingState
        ? `${c.mailingAddress}|${c.mailingCity}|${c.mailingState}|${c.mailingZip || ""}`.toLowerCase()
        : null;

    const masterPhones = new Set(master.phones.map(p => p.number));
    const masterEmails = new Set(master.emails.map(e => e.email.toLowerCase().trim()));
    const masterAddress = normalizeAddress(master);
    const masterMailingAddress = normalizeMailingAddress(master);

    const unrelated = duplicates.filter(d => {
      const sharesPhone = d.phones.some(p => masterPhones.has(p.number));
      const sharesEmail = d.emails.some(e => masterEmails.has(e.email.toLowerCase().trim()));
      const sharesAddress = masterAddress !== null && normalizeAddress(d) === masterAddress;
      const sharesMailingAddress = masterMailingAddress !== null && normalizeMailingAddress(d) === masterMailingAddress;
      return !(sharesPhone || sharesEmail || sharesAddress || sharesMailingAddress);
    });

    if (unrelated.length > 0) {
      throwHttp(
        400,
        `These contacts don't share a phone, email, or address with the selected primary contact, so they can't be merged: ${unrelated.map(c => c.fullName).join(", ")}`
      );
    }

    // 2. Aggregate Data
    // PHONES: Unique by number
    const allPhonesMap = new Map<string, { number: string; type: PhoneType }>();
    contacts.forEach(c => {
      c.phones.forEach(p => {
        if (!allPhonesMap.has(p.number)) {
          allPhonesMap.set(p.number, { number: p.number, type: p.type as PhoneType });
        }
      });
    });

    // EMAILS: Unique by email
    const allEmailsMap = new Map<string, { email: string; isPrimary: boolean }>();
    contacts.forEach(c => {
      c.emails.forEach(e => {
        const normalized = e.email.toLowerCase().trim();
        if (!allEmailsMap.has(normalized)) {
          allEmailsMap.set(normalized, { email: e.email, isPrimary: e.isPrimary });
        }
      });
    });

    // ARRAYS: Tags, Notes
    const allTags = Array.from(new Set(contacts.flatMap(c => c.tags || [])));
    const allNotes = contacts.flatMap(c => c.notes || []);

    // 3. Re-link relations
    // Call Records
    await tx.callRecord.updateMany({
      where: { contactId: { in: duplicateIds } },
      data: { contactId: masterId }
    });

    // Attachments
    await tx.attachment.updateMany({
      where: { contactId: { in: duplicateIds } },
      data: { contactId: masterId }
    });

    // 4. Update Master Record & Location Cleanup
    // Exclusive Move: Remove from ALL lists first
    const affectedLists = await tx.contactList.findMany({
      where: { contactIds: { hasSome: allIds } },
      select: { id: true, contactIds: true }
    });

    await Promise.all(affectedLists.map((list) => {
      const newContactIds = list.contactIds.filter(id => !allIds.includes(id));
      return tx.contactList.update({
        where: { id: list.id },
        data: { contactIds: newContactIds }
      });
    }));

    // Add to target list
    const targetList = await tx.contactList.findUnique({
      where: { id: targetListId },
      select: { contactIds: true }
    });
    if (targetList) {
      await tx.contactList.update({
        where: { id: targetListId },
        data: { contactIds: Array.from(new Set([...targetList.contactIds, masterId])) }
      });
    }

    // Final merge update
    const updatedMaster = await tx.contact.update({
      where: { id: masterId },
      data: {
        phones: {
          deleteMany: {},
          create: Array.from(allPhonesMap.values())
        },
        emails: {
          deleteMany: {},
          create: Array.from(allEmailsMap.values())
        },
        tags: allTags,
        notes: allNotes,
        folderIds: [targetFolderId], // Exclusive Move
      },
      include: {
        phones: true,
        emails: true,
      }
    });

    // 5. Cleanup Duplicates
    await tx.contact.deleteMany({
      where: { id: { in: duplicateIds } }
    });

    // 6. Audit Log
    await tx.auditLog.create({
      data: {
        userId,
        action: "Merged contacts (Targeted)",
        details: `Master: ${masterId}. Target Folder: ${targetFolderId}. Target List: ${targetListId}.`
      }
    });

    return updatedMaster;
  }, {
    timeout: 35000
  });
}

// CONTACT outcome: reached → mark contacted, flag the dialed number as the best
// number (green), and remove the contact from every list so it leaves the dial
// queue (placed in the contacted state).
export async function markAsContactedInDb(contactId: string, userId: string, phoneId?: string) {
  return prisma.$transaction(async (tx) => {
    if (phoneId) {
      await tx.contactPhone.updateMany({ where: { contactId }, data: { isBestNumber: false } });
      await tx.contactPhone.update({ where: { id: phoneId }, data: { isBestNumber: true } });
    }

    await tx.contact.update({
      where: { id: contactId },
      data: { status: "CONTACTED" },
    });

    return tx.contactActivityLog.create({
      data: { contactId, userId, action: "Marked as Contact" },
    });
  });
}

// BAD_NUMBER outcome: mark just this number invalid so it is struck through in
// the contact card and never dialed again. The contact stays dialable on its
// other numbers (no DNC, no suppression).
export async function markPhoneInvalidInDb(contactId: string, phoneId: string, userId: string) {
  await prisma.contactPhone.update({
    where: { id: phoneId },
    data: { isValid: false },
  });
  await prisma.contactActivityLog.create({
    data: { contactId, userId, action: "Bad Number marked" },
  });
  return { success: true };
}

// DNC_NUMBER outcome: globally suppress this phone number across ALL lists and
// contacts in the tenant. Records it in SuppressedNumber (so future imports are
// caught too) and flags every existing matching phone as DNC.
export async function suppressNumberGloballyInDb(number: string, userId: string, contactId?: string) {
  const rootId = await resolveTenantRootId(userId);

  await prisma.suppressedNumber.upsert({
    where: { userId_number: { userId: rootId, number } },
    create: { userId: rootId, number, reason: "DNC Number" },
    update: {},
  });

  const tenantUserIds = await resolveTenantUserIds(userId);
  await prisma.contactPhone.updateMany({
    where: {
      number,
      ...(tenantUserIds ? { contact: { userId: { in: tenantUserIds } } } : {}),
    },
    data: { isDnc: true },
  });

  if (contactId) {
    await prisma.contactActivityLog.create({
      data: { contactId, userId, action: `DNC Number suppressed: ${number}` },
    });

    // If that was the contact's only number (or the last one not already DNC),
    // the whole contact is now undialable — move it to the DNC folder too,
    // same as the DNC_CONTACT outcome, instead of leaving it stranded in its
    // list with zero callable numbers.
    const remainingPhones = await prisma.contactPhone.findMany({
      where: { contactId },
      select: { isDnc: true },
    });
    const allNumbersDnc = remainingPhones.length > 0 && remainingPhones.every((p) => p.isDnc);
    if (allNumbersDnc) {
      await moveToDncInDb(contactId, userId);
    }
  }
  return { success: true };
}

export async function getContactActivityLogsFromDb(contactId: string) {
  return prisma.contactActivityLog.findMany({
    where: { contactId },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateDialAttemptsInDb(contactId: string, action: 'increment' | 'decrement' | 'reset') {
  if (action === 'reset') {
    await prisma.$executeRaw`UPDATE contacts SET "dialAttempts" = 0 WHERE id = ${contactId}`;
  } else if (action === 'increment') {
    await prisma.$executeRaw`UPDATE contacts SET "dialAttempts" = "dialAttempts" + 1 WHERE id = ${contactId}`;
  } else {
    await prisma.$executeRaw`UPDATE contacts SET "dialAttempts" = GREATEST(0, "dialAttempts" - 1) WHERE id = ${contactId}`;
  }
  const rows = await prisma.$queryRaw<{ dialAttempts: number }[]>`
    SELECT "dialAttempts" FROM contacts WHERE id = ${contactId}
  `;
  return { dialAttempts: rows[0]?.dialAttempts ?? 0 };
}
