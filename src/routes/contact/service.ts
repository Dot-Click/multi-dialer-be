import { PhoneType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { leadSheetEmailTemp, sendEmail } from "../../utils/email";
import axios from "axios";
import { uploadToR2 } from "../../utils/r2-uploader";
import { randomUUID } from "crypto";
import { createInternalNotification } from "../notification/controller";
import { envConfig } from "@/lib/config";


function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

const REALTOR_API_BASE_URL = "https://realtor-com4.p.rapidapi.com";

function normalizeText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function recursiveFindByKeys(value: any, keys: string[]): any[] {
  const results: any[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      results.push(...recursiveFindByKeys(item, keys));
    }
    return results;
  }

  if (value && typeof value === "object") {
    const normalizedEntries = Object.entries(value).map(([key, entryValue]) => ({
      key: key.toLowerCase(),
      value: entryValue,
    }));

    for (const entry of normalizedEntries) {
      if (keys.includes(entry.key)) {
        results.push(entry.value);
      }
      results.push(...recursiveFindByKeys(entry.value, keys));
    }
  }

  return results;
}

function collectPropertyCandidates(value: any): Array<Record<string, any>> {
  const candidates: Array<Record<string, any>> = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      candidates.push(...collectPropertyCandidates(item));
    }
    return candidates;
  }

  if (value && typeof value === "object") {
    const propertyId = value.property_id ?? value.propertyId ?? value.mpr_id ?? value.mprid ?? value.geo_id;
    if (propertyId) {
      candidates.push(value);
    }

    for (const entryValue of Object.values(value)) {
      candidates.push(...collectPropertyCandidates(entryValue));
    }
  }

  return candidates;
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

function scorePropertyCandidate(
  candidate: Record<string, any>,
  target: { address: string; city: string; state: string; zip: string }
): number {
  const candidateBlob = normalizeText(JSON.stringify(candidate));
  let score = 0;

  if (target.address && candidateBlob.includes(target.address)) score += 6;
  if (target.city && candidateBlob.includes(target.city)) score += 3;
  if (target.state && candidateBlob.includes(target.state)) score += 2;
  if (target.zip && candidateBlob.includes(target.zip)) score += 4;

  return score;
}

function pickBestPropertyId(autoCompletePayload: any, contact: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const normalizedTarget = {
    address: normalizeText(contact.address),
    city: normalizeText(contact.city),
    state: normalizeText(contact.state),
    zip: normalizeText(contact.zip),
  };

  const candidates = collectPropertyCandidates(autoCompletePayload);

  if (candidates.length > 0) {
    const ranked = candidates
      .map((candidate) => ({
        propertyId: String(candidate.property_id ?? candidate.propertyId ?? candidate.mpr_id ?? candidate.mprid ?? candidate.geo_id),
        score: scorePropertyCandidate(candidate, normalizedTarget),
      }))
      .filter((candidate) => candidate.propertyId);

    ranked.sort((a, b) => b.score - a.score);
    if (ranked[0]?.propertyId) {
      return ranked[0].propertyId;
    }
  }

  const propertyIds = recursiveFindByKeys(autoCompletePayload, ["property_id", "propertyid", "mpr_id", "mprid", "geo_id"])
    .map((propertyId) => String(propertyId))
    .filter(Boolean);

  return propertyIds[0] ?? null;
}

function extractRealtorUrl(value: any): string | null {
  if (typeof value === "string") {
    if (value.startsWith("https://www.realtor.com/")) return value;
    if (value.startsWith("http://www.realtor.com/")) return value.replace("http://", "https://");
    if (value.startsWith("/realestateandhomes-detail/")) return `https://www.realtor.com${value}`;
    if (value.startsWith("realestateandhomes-detail/")) return `https://www.realtor.com/${value}`;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedUrl = extractRealtorUrl(item);
      if (nestedUrl) return nestedUrl;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const [key, entryValue] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (
        typeof entryValue === "string" &&
        ["href", "permalink", "url", "link", "web_url", "rdc_web_url"].includes(normalizedKey)
      ) {
        const resolvedUrl = extractRealtorUrl(entryValue);
        if (resolvedUrl) return resolvedUrl;
      }

      const nestedUrl = extractRealtorUrl(entryValue);
      if (nestedUrl) return nestedUrl;
    }
  }

  return null;
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

export async function getRealtorLinkForContactInDb(contactId: string) {
  console.log("[Realtor] Starting realtor link fetch for contact:", contactId);
  
  if (!envConfig.REALTOR_RAPIDAPI_KEY) {
    console.error("[Realtor] REALTOR_RAPIDAPI_KEY is not configured");
    throwHttp(500, "Realtor RapidAPI key is not configured on the server");
  }

  console.log("[Realtor] API Key present:", !!envConfig.REALTOR_RAPIDAPI_KEY);
  console.log("[Realtor] API Host:", envConfig.REALTOR_RAPIDAPI_HOST);

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
    console.error("[Realtor] Contact not found:", contactId);
    throwHttp(404, "Contact not found");
  }

  const addressQuery = buildContactAddress(contact);
  console.log("[Realtor] Address query:", addressQuery);
  
  if (!addressQuery) {
    console.error("[Realtor] No property address for contact:", contactId);
    throwHttp(400, "Contact does not have a property address");
  }

  const rapidApiHeaders = {
    "Content-Type": "application/json",
    "x-rapidapi-host": envConfig.REALTOR_RAPIDAPI_HOST || "realtor-com4.p.rapidapi.com",
    "x-rapidapi-key": envConfig.REALTOR_RAPIDAPI_KEY,
  };

  let propertyId: string | null = null;
  let realtorUrl: string | null = null;

  try {
    console.log("[Realtor] Calling auto-complete API...");
    const autoCompleteResponse = await axios.get(
      `${REALTOR_API_BASE_URL}/auto-complete`,
      {
        params: { input: addressQuery },
        headers: rapidApiHeaders,
      }
    );
    console.log("[Realtor] Auto-complete response received");
    console.log(autoCompleteResponse.data)

    propertyId = pickBestPropertyId(autoCompleteResponse.data, contact);
    console.log("[Realtor] Property ID:", propertyId);
    
    if (!propertyId) {
      console.error("[Realtor] No property match found for:", addressQuery);
      throwHttp(404, "No Realtor property match was found for this address");
    }

    console.log("[Realtor] Calling properties/detail API...");
    const detailResponse = await axios.get(
      `${REALTOR_API_BASE_URL}/properties/detail`,
      {
        params: { property_id: propertyId },
        headers: rapidApiHeaders,
      }
    );

    console.log("[Realtor] Detail response received");
    realtorUrl = extractRealtorUrl(detailResponse.data);
    console.log("[Realtor] Realtor URL:", realtorUrl);
    
    if (!realtorUrl) {
      console.error("[Realtor] No URL in detail response");
      throwHttp(404, "The Realtor detail response did not include a property URL");
    }
  } catch (error: any) {
    console.error("[Realtor] Error occurred:", error?.message);
    console.error("[Realtor] Error status:", error?.response?.status);
    console.error("[Realtor] Error data:", error?.response?.data);
    
    if (error?.statusCode) {
      throw error;
    }

    const statusCode = error?.response?.status || 502;
    const providerMessage =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      "Failed to fetch Realtor property details";

    throwHttp(statusCode, providerMessage);
  }

  return {
    contactId: contact.id,
    propertyId,
    addressQuery,
    realtorUrl,
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
    phones: { number: string; type: any }[];
    notes: string[];
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

  const newStatus = payload.status || payload.disposition;
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
  payload: { name: string; contactIds: string[]; folderId?: string },
  userId: string,
) {
  return prisma.contactList.create({
    data: {
      name: payload.name,
      contactIds: payload.contactIds,
      folderId: payload.folderId,
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
          { userId: userId, isSystem: true } // Agents see their own system folders (DNC)
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
  await sendEmail(
    recipientEmail,
    `Lead Sheet: ${leadSheet.title} - ${contact.fullName}`,
    html,
    { userId, contactId }
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

    // 1. Mark contact as DO_NOT_CALL and move to system DNC folder
    const dncFolder = await ensureDncFolder(userId);

    await tx.contact.update({
      where: { id: contactId },
      data: {
        status: "DO_NOT_CALL",
        folderIds: { push: dncFolder?.id || undefined }
      },
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
  return prisma.$transaction(async (tx) => {
    const newList = await tx.contactList.findUnique({
      where: { id: listId },
      select: { id: true, name: true, contactIds: true },
    });
    if (!newList) throwHttp(404, "Target List not found");

    await Promise.all(contactIds.map(async (contactId) => {
      // Remove contact from every other list it currently belongs to
      const currentLists = await tx.contactList.findMany({
        where: { contactIds: { has: contactId } },
        select: { id: true, contactIds: true },
      });
      await Promise.all(currentLists.map((l) => {
        if (l.id !== listId) {
          return tx.contactList.update({
            where: { id: l.id },
            data: { contactIds: l.contactIds.filter((id) => id !== contactId) },
          });
        }
        return Promise.resolve();
      }));

      // Add to target list if not already present
      if (!newList.contactIds.includes(contactId)) {
        await tx.contactList.update({
          where: { id: listId },
          data: { contactIds: { push: contactId } },
        });
      }

      await tx.contact.update({
        where: { id: contactId },
        data: { source: newList.name },
      });
    }));

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

export async function getDncListFromDb() {
  return prisma.contact.findMany({
    where: { status: "DO_NOT_CALL" },
    include: { phones: true, emails: true },
    orderBy: { updatedAt: "desc" },
  });
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
        mailingAddress: c.mailingAddress || null,
        mailingAddress2: c.mailingAddress2 || null,
        mailingCity: c.mailingCity || null,
        mailingState: c.mailingState || null,
        mailingZip: c.mailingZip || null,
        source: c.source || "CSV Import",
        notes: c.notes ? (Array.isArray(c.notes) ? c.notes : [String(c.notes)]) : [],
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
            notes: incoming.notes ? (Array.isArray(incoming.notes) ? incoming.notes : [String(incoming.notes)]) : [],
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

export async function sendTemplateEmailInDb(contactId: string, templateId: string, userId: string) {
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

  await sendEmail(email, template.subject, content, { userId, contactId, templateId });

  return true;
}

export async function scheduleTemplateEmailInDb(contactId: string, templateId: string, scheduledAt: string) {
  // Since we don't have a background worker set up in this demo, 
  // we'll just log it to the console and return success.
  // In a real app, you'd insert into a 'ScheduledEmails' table or a Bull queue.
  console.log(`[SCHEDULED] Email template ${templateId} to contact ${contactId} at ${scheduledAt}`);
  return true;
}
export const getDuplicateContactsFromDb = async () => {
  // ── 1. Find Duplicate identifiers ───────────────────────────────

  // A. Phones
  const dupPhones = await prisma.contactPhone.groupBy({
    by: ['number'],
    _count: { number: true },
    having: { number: { _count: { gt: 1 } } },
  });
  const dupPhoneNumbers = dupPhones.map((p) => p.number);

  // B. Emails
  const dupEmailsRaw = await prisma.contactEmail.groupBy({
    by: ['email'],
    _count: { email: true },
    having: { email: { _count: { gt: 1 } } },
  });
  const dupEmailAddresses = dupEmailsRaw.map((e) => e.email);

  // C. Property Addresses
  const dupPropAddresses = await prisma.contact.groupBy({
    by: ['address', 'city', 'state', 'zip'],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
    where: { address: { not: null }, city: { not: null }, state: { not: null } }
  });

  // D. Mailing Addresses
  const dupMailAddresses = await prisma.contact.groupBy({
    by: ['mailingAddress', 'mailingCity', 'mailingState', 'mailingZip'],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
    where: { mailingAddress: { not: null }, mailingCity: { not: null }, mailingState: { not: null } }
  });

  // ── 2. Fetch All Contacts with Duplicates ──────────────────────────
  const contacts = await prisma.contact.findMany({
    where: {
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
  return contacts.map(c => {
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
      locationContext: [...folderNames.map(n => `Folder: ${n}`), ...listNames.map(n => `List: ${n}`)].join(", ")
    };
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

    // ── CASE 1: Contextual Removal from Folder ──────────────────────────────────
    if (folderId && !hardDelete) {
      // 1. Fetch contacts and remove the specific folderId from their arrays
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds }, folderIds: { has: folderId } },
        select: { id: true, folderIds: true }
      });

      await Promise.all(contacts.map((contact) => tx.contact.update({
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
            contactIds: folder.contactIds.filter(id => !contactIds.includes(id))
          }
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: `Bulk removed ${contactIds.length} contacts from folder`,
          details: `Folder ID: ${folderId}`
        }
      });

      return { success: true, count: contactIds.length, mode: 'removed_from_folder' };
    }

    // ── CASE 2: Contextual Removal from List ────────────────────────────────────
    if (listId && !hardDelete) {
      const list = await tx.contactList.findUnique({
        where: { id: listId },
        select: { id: true, contactIds: true }
      });

      if (list) {
        await tx.contactList.update({
          where: { id: listId },
          data: {
            contactIds: list.contactIds.filter(id => !contactIds.includes(id))
          }
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: `Bulk removed ${contactIds.length} contacts from list`,
          details: `List ID: ${listId}`
        }
      });

      return { success: true, count: contactIds.length, mode: 'removed_from_list' };
    }

    // ── CASE 3: Hard Delete or Smart Safe-Unlink ────────────────────────────────
    if (!hardDelete) {
      // SMART SAFE-UNLINK: If no folderId was provided, remove from ALL folders
      // but keep the contact record. This prevents accidental global purge.
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, folderIds: true }
      });

      await Promise.all(contacts.map((contact) => tx.contact.update({
        where: { id: contact.id },
        data: { folderIds: [] } // Unassign from all folders
      })));

      await tx.auditLog.create({
        data: {
          userId,
          action: `Bulk safe-unassigned ${contactIds.length} contacts from all folders`,
        }
      });

      return { success: true, count: contactIds.length, mode: 'safe_unassign' };
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
      await tx.contact.updateMany({
        where: { id: { in: contactIds } },
        data: { folderIds: [folderId] }
      });
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
