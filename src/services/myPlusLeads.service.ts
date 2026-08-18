import { getStripeClient } from "../lib/stripe";
import prisma from "../lib/prisma";
import { decryptEIN as decrypt, encryptEIN as encrypt } from "../utils/encryption";
import { chunkArray } from "@/utils/helpers";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { ensureDefaultMiscFields } from "../routes/systemSettings/miscFields/service";
import { PhoneType } from "@prisma/client";

const BASE_URL = "https://api.myplusleads.com";

export interface MyPlusLead {
  listingId: number;
  processedDate?: string;
  propertyAddress?: {
    streetAddress?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
  };
  owner?: {
    firstName?: string;
    lastName?: string;
    name?: string;
    name2?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    totalValue?: string;
    occupied?: boolean;
    saleAmount?: string;
    saleDate?: string;
    assessed_value?: string;
    livingSquareFeet?: string;
    yearBuilt?: string;
    taxYear?: string;
    apn?: string;
  };
  agent?: {
    agentName?: string;
    agentPhone?: string;
    agentEmail?: string;
    agentOffice?: string;
  };
  propertyDetails?: {
    mlsNumber?: string;
    normalizedStatus?: string;
    status?: string;
    price?: string;
    bedrooms?: string;
    bathrooms?: string;
    square_footage?: string;
    propertyType?: string;
    lotSize?: string;
    yearBuilt?: string;
    taxes?: string;
    remarks?: string;
    subdivision?: string;
    listingTitle?: string;
    url?: string;
  };
  contact1?: {
    name?: string;
    phone1?: string;
    phone2?: string;
    email?: string;
    dnc1?: boolean;
    dnc2?: boolean;
  };
  contact2?: {
    name?: string;
    phone1?: string;
    phone2?: string;
    email?: string;
    dnc1?: boolean;
    dnc2?: boolean;
  };
  augmentedData1?: AugmentedContact;
  augmentedData2?: AugmentedContact;
  augmentedData3?: AugmentedContact;
  augmentedData4?: AugmentedContact;
  augmentedData5?: AugmentedContact;
}

interface AugmentedContact {
  augmentedName1?: string;
  augmentedPhone1?: string;
  augmentedPhone2?: string;
  augmentedPhone3?: string;
  augmentedPhone4?: string;
  augmentedEmail1?: string;
  augmentedEmail2?: string;
  augmentedEmail3?: string;
  lineType1?: string;
  lineType2?: string;
  lineType3?: string;
  lineType4?: string;
  dnc1?: boolean;
  dnc2?: boolean;
  dnc3?: boolean;
  dnc4?: boolean;
}

export type MyPlusLeadsSyncResult = {
  fetched: number;
  imported: number;
  skipped: number;
};

// MyPlusLeads' raw per-listing status is finer-grained than the products we
// sell — e.g. "Expired Data" is sold as one product but MPL tags listings
// that fell out of the market as "Expired", "Withdrawn", or "Canceled"
// separately. Group those under one canonical package so an assignment of
// "Expired" pulls all three, instead of only literally-"Expired" listings.
const PACKAGE_GROUPS: Record<string, string[]> = {
  Expired: ["Expired", "Withdrawn", "Canceled"],
};

const RAW_STATUS_TO_PACKAGE = new Map<string, string>();
for (const [pkg, rawStatuses] of Object.entries(PACKAGE_GROUPS)) {
  for (const raw of rawStatuses) RAW_STATUS_TO_PACKAGE.set(raw, pkg);
}

export function resolveCanonicalPackage(rawStatus: string): string {
  return RAW_STATUS_TO_PACKAGE.get(rawStatus) ?? rawStatus;
}

class MyPlusLeadsError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function responseErrorMessage(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return body ? `${res.status} - ${body.slice(0, 500)}` : String(res.status);
}

function extractAuthToken(data: any): string | null {
  const token =
    data?.authenticatedToken ??
    data?.authToken ??
    data?.token ??
    data?.accessToken ??
    data?.access_token ??
    data?.data?.authenticatedToken ??
    data?.data?.authToken ??
    data?.data?.token ??
    data?.data?.accessToken ??
    data?.data?.access_token ??
    null;

  if (typeof token === "string" && token.trim()) {
    return token;
  }

  const code = data?.code ?? data?.data?.code;
  if (typeof code === "string" && code.trim().length > 8) {
    return code;
  }

  return null;
}

function describeAuthResponse(data: any): string {
  const topLevelKeys = data && typeof data === "object" ? Object.keys(data) : [];
  const nestedKeys = data?.data && typeof data.data === "object" ? Object.keys(data.data) : [];
  const parts = [`top-level keys: ${topLevelKeys.join(", ") || "none"}`];
  if (data && Object.prototype.hasOwnProperty.call(data, "status")) {
    parts.push(`status: ${String(data.status)}`);
  }
  if (data && Object.prototype.hasOwnProperty.call(data, "code")) {
    parts.push(`code type: ${typeof data.code}`);
    if (typeof data.code === "number") {
      parts.push(`code: ${data.code}`);
    }
    if (typeof data.code === "string") {
      parts.push(`code length: ${data.code.length}`);
    }
  }
  if (nestedKeys.length > 0) {
    parts.push(`data keys: ${nestedKeys.join(", ")}`);
  }

  return parts.join("; ");
}

async function parseAuthResponse(res: Response, label: string): Promise<string | null> {
  if (!res.ok) {
    throw new MyPlusLeadsError(`${label} failed: ${await responseErrorMessage(res)}`, 502);
  }

  const data = await res.json();
  const authToken = extractAuthToken(data);
  if (authToken) {
    return authToken;
  }

  const status = typeof data?.status === "string" ? data.status : "";
  const code = typeof data?.code === "number" ? data.code : null;
  if (code === 401 || /authorization failed|unauthorized|invalid/i.test(status)) {
    throw new MyPlusLeadsError(`${label} failed: ${status || "Unauthorized"}${code ? ` (${code})` : ""}.`, 502);
  }

  console.warn(`[MyPlusLeads] ${label} returned no token (${describeAuthResponse(data)}).`);
  return null;
}

export async function authenticateSubAccount(email: string, password: string): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const authToken = await parseAuthResponse(res, "MyPlusLeads sub-account auth");
  if (!authToken) {
    throw new MyPlusLeadsError("MyPlusLeads sub-account auth response did not include an auth token.", 502);
  }

  return authToken;
}

export async function fetchListings(subEmail: string, subPassword: string): Promise<MyPlusLead[]> {
  // Fetch a single page using a freshly-obtained token. MPL's paging tokens
  // seem to be single-use in some sessions, so we re-auth per page to avoid 401.
  const fetchPage = async (url: string): Promise<any> => {
    const token = await authenticateSubAccount(subEmail, subPassword);
    // The paging.next URL ends with "authToken=" (empty) — append our token.
    const fullUrl = url.endsWith("authToken=") ? url + encodeURIComponent(token) : url;
    const res = await fetchWithTimeout(fullUrl);
    if (!res.ok) {
      throw new MyPlusLeadsError(`MyPlusLeads page fetch failed: ${await responseErrorMessage(res)}`, 502);
    }
    return res.json();
  };

  const token = await authenticateSubAccount(subEmail, subPassword);
  const firstUrl = `${BASE_URL}/listings?authToken=${encodeURIComponent(token)}`;
  const firstRes = await fetchWithTimeout(firstUrl);
  if (!firstRes.ok) {
    throw new MyPlusLeadsError(`MyPlusLeads listings fetch failed: ${await responseErrorMessage(firstRes)}`, 502);
  }
  const firstData = await firstRes.json();
  const listings: MyPlusLead[] = firstData.listings ?? [];
  console.log(`[MyPlusLeads] Page 1: fetched ${listings.length} listings`);

  // Follow paging.next, re-authenticating for each subsequent page.
  const MAX_PAGES = 20;
  let nextUrl: string | undefined = firstData.paging?.next;
  let page = 1;

  while (nextUrl && page < MAX_PAGES) {
    try {
      const pageData = await fetchPage(nextUrl);
      const pageListings: MyPlusLead[] = pageData.listings ?? [];
      if (pageListings.length === 0) break;

      const existingIds = new Set(listings.map((l) => l.listingId));
      for (const pl of pageListings) {
        if (!existingIds.has(pl.listingId)) {
          listings.push(pl);
        }
      }
      console.log(`[MyPlusLeads] Page ${page + 1}: fetched ${pageListings.length} listings (total: ${listings.length})`);

      nextUrl = pageData.paging?.next;
      page++;
    } catch (e: any) {
      console.warn(`[MyPlusLeads] Page ${page + 1} fetch failed, continuing with ${listings.length} listings:`, e?.message ?? e);
      break;
    }
  }

  return listings;
}

/**
 * Groups a MyPlusLeads account's current listings by data package (e.g.
 * "Expired", "FSBO", "FRBO") so Client can see and assign exactly the package
 * a customer purchased, since one account can carry several. Fetched live —
 * not a separate MyPlusLeads endpoint, just grouping the listings response.
 */
export async function discoverAccountPackages(configId: string): Promise<{ package: string; count: number }[]> {
  const config = await prisma.myPlusLeadsConfig.findUnique({ where: { id: configId } });
  if (!config) {
    throw new MyPlusLeadsError("MyPlusLeads account not found.", 404);
  }
  if (!config.subAccountEmail || !config.subAccountPassword) {
    throw new MyPlusLeadsError("MyPlusLeads sub-account credentials are missing for this account.", 400);
  }

  const password = decrypt(config.subAccountPassword);
  const listings = await fetchListings(config.subAccountEmail, password);

  const counts = new Map<string, number>();
  for (const listing of listings) {
    const rawStatus = listing.propertyDetails?.normalizedStatus ?? listing.propertyDetails?.status ?? "Expired";
    const pkg = resolveCanonicalPackage(rawStatus);
    counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([pkg, count]) => ({ package: pkg, count }));
}

/**
 * Syncs a single Lead Store purchase: pulls its linked account's listings but
 * only imports the ones matching the package assigned to this purchase — an
 * account with several active packages only ever feeds each customer the one
 * they're entitled to.
 */
// Per-user sync mutex. Two overlapping sync calls for the same user (e.g. a
// double-click on "Sync MPL", or the cron overlapping a manual sync) would
// both `findFirst` the same MLS, both miss the dedup, and both `create` a
// duplicate. Chain them instead: the second caller waits for the first to
// finish, then re-runs — its own dedup pass will now see the fresh rows and
// correctly skip.
const userSyncQueue = new Map<string, Promise<unknown>>();

async function withUserSyncLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = (userSyncQueue.get(userId) ?? Promise.resolve()) as Promise<unknown>;
  const next = previous.catch(() => undefined).then(fn);
  userSyncQueue.set(userId, next);
  try {
    return await next;
  } finally {
    if (userSyncQueue.get(userId) === next) userSyncQueue.delete(userId);
  }
}

export async function syncLeadsForLeadStore(leadStoreId: string): Promise<MyPlusLeadsSyncResult> {
  const leadStore = await prisma.leadStore.findUnique({ where: { id: leadStoreId } });
  if (!leadStore) {
    throw new MyPlusLeadsError("Lead Store purchase not found.", 404);
  }
  if (!leadStore.myPlusLeadsConfigId) {
    throw new MyPlusLeadsError("No MyPlusLeads account is linked to this purchase.", 400);
  }
  if (!leadStore.assignedPackage) {
    throw new MyPlusLeadsError("No data package has been assigned to this purchase.", 400);
  }

  return withUserSyncLock(leadStore.userId, () => syncLeadsForLeadStoreImpl(leadStore.id));
}

async function syncLeadsForLeadStoreImpl(leadStoreId: string): Promise<MyPlusLeadsSyncResult> {
  const leadStore = await prisma.leadStore.findUnique({ where: { id: leadStoreId } });
  if (!leadStore) {
    throw new MyPlusLeadsError("Lead Store purchase not found.", 404);
  }
  if (!leadStore.myPlusLeadsConfigId) {
    throw new MyPlusLeadsError("No MyPlusLeads account is linked to this purchase.", 400);
  }
  if (!leadStore.assignedPackage) {
    throw new MyPlusLeadsError("No data package has been assigned to this purchase.", 400);
  }

  const config = await prisma.myPlusLeadsConfig.findUnique({ where: { id: leadStore.myPlusLeadsConfigId } });
  if (!config) {
    throw new MyPlusLeadsError("MyPlusLeads account not found.", 404);
  }

  const { userId } = leadStore;
  const assignedPackage = leadStore.assignedPackage;

  if (config.status !== "CONNECTED") {
    throw new MyPlusLeadsError(`MyPlusLeads account is not connected. Current status: ${config.status}.`, 400);
  }

  if (!config.subAccountEmail || !config.subAccountPassword) {
    throw new MyPlusLeadsError("MyPlusLeads sub-account credentials are missing for this account.", 400);
  }

  const password = decrypt(config.subAccountPassword);

  const allListings = await fetchListings(config.subAccountEmail, password);
  const listings = allListings.filter((l) => {
    const rawStatus = l.propertyDetails?.normalizedStatus ?? l.propertyDetails?.status ?? "Expired";
    return resolveCanonicalPackage(rawStatus) === assignedPackage;
  });
  let imported = 0;
  let skipped = 0;

  // Cache of status → ContactList (created on first encounter per sync run).
  const listCache = new Map<string, { id: string }>();

  const getOrCreateList = async (status: string) => {
    if (listCache.has(status)) return listCache.get(status)!;
    let list = await prisma.contactList.findFirst({
      where: { userId, name: status, folderId: null },
    });
    if (!list) {
      list = await prisma.contactList.create({
        data: { name: status, userId, contactIds: [] },
      });
    }
    listCache.set(status, list);
    return list;
  };

  // Ensure the user's MiscField catalog has the property-detail fields we
  // populate below, then build a name → id map used to key miscValues.
  let systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSetting) {
    systemSetting = await prisma.system_Setting.create({ data: { userId } });
  }
  await ensureDefaultMiscFields(systemSetting.id);
  const miscFields = await prisma.miscField.findMany({
    where: { systemSettingId: systemSetting.id },
    select: { id: true, fieldName: true },
  });
  const miscFieldIdByName = new Map<string, string>();
  for (const f of miscFields) {
    miscFieldIdByName.set(f.fieldName.trim().toLowerCase(), f.id);
  }
  const buildMiscValues = (l: MyPlusLead): Record<string, string> => {
    const values: Record<string, string> = {};
    const set = (name: string, value?: string | number | boolean | null) => {
      if (value === undefined || value === null || value === "") return;
      const id = miscFieldIdByName.get(name.trim().toLowerCase());
      if (id) values[id] = String(value);
    };
    const pd = l.propertyDetails;
    const pa = l.propertyAddress;
    const ow = l.owner;
    const ag = l.agent;

    // Property details
    set("MLS ID", pd?.mlsNumber);
    set("Price", pd?.price);
    set("List Price", pd?.price);
    set("Bedrooms", pd?.bedrooms);
    set("Bathrooms", pd?.bathrooms);
    set("Square Footage", pd?.square_footage);
    set("Property Type", pd?.propertyType);
    set("Listing Status", pd?.normalizedStatus ?? pd?.status);
    set("Lot Size", pd?.lotSize);
    set("Year Built", pd?.yearBuilt ?? ow?.yearBuilt);
    set("Taxes", pd?.taxes);
    set("Subdivision", pd?.subdivision);
    set("Listing Title", pd?.listingTitle);
    set("Listing URL", pd?.url);

    // Location
    set("County", pa?.county);

    // Owner / valuation
    set("Estimated Value", ow?.totalValue);
    set("Assessed Value", ow?.assessed_value);
    set("Last Sale Amount", ow?.saleAmount);
    set("Last Sale Date", ow?.saleDate);
    set("Living Square Feet", ow?.livingSquareFeet);
    set("Tax Year", ow?.taxYear);
    set("APN", ow?.apn);
    if (ow?.occupied !== undefined && ow?.occupied !== null) {
      set("Occupied", ow.occupied ? "Yes" : "No");
    }

    // Agent
    set("Agent Name", ag?.agentName);
    set("Agent Phone Number", ag?.agentPhone);
    set("Agent Email", ag?.agentEmail);
    set("Agent Company", ag?.agentOffice);

    return values;
  };

  for (const listingChunk of chunkArray(listings, 50)) {
    for (const listing of listingChunk) {
      const contact1 = listing.contact1;
      if (!contact1?.name) {
        skipped++;
        continue;
      }

      const currentStatus = listing.propertyDetails?.normalizedStatus ?? listing.propertyDetails?.status ?? "Expired";
      const source = listing.propertyDetails?.mlsNumber ?? String(listing.listingId);
      const existing = await prisma.contact.findFirst({
        where: { userId, source },
        select: { id: true, miscValues: true, description: true },
      });
      if (existing) {
        // Backfill fields that were empty for contacts imported before the
        // full property-detail mapping shipped. Deliberately do NOT touch
        // tags or list membership here — once a contact is imported, list
        // membership belongs to the user (they may have called it, moved it,
        // or removed it on purpose), and re-adding it on every sync would
        // undo their workflow. If the user wants automatic realignment they
        // can trigger it explicitly via the repair action.
        const currentMisc = (existing.miscValues as Record<string, string> | null) ?? null;
        const hasNoMisc = !currentMisc || Object.keys(currentMisc).length === 0;
        const hasNoDescription = !existing.description || existing.description.trim() === "";
        const patch: Record<string, unknown> = {};
        if (hasNoMisc) {
          const backfill = buildMiscValues(listing);
          if (Object.keys(backfill).length > 0) patch.miscValues = backfill;
        }
        if (hasNoDescription && listing.propertyDetails?.remarks) {
          patch.description = listing.propertyDetails.remarks;
        }
        if (Object.keys(patch).length > 0) {
          await prisma.contact.update({ where: { id: existing.id }, data: patch });
        }
        skipped++;
        continue;
      }

      const status = currentStatus;
      const prop = listing.propertyAddress;
      const owner = listing.owner;
      const list = await getOrCreateList(status);

      const miscValues = buildMiscValues(listing);
      const newContact = await prisma.contact.create({
        data: {
          fullName: contact1.name,
          userId,
          address: prop?.streetAddress ?? null,
          city: prop?.city ?? null,
          state: prop?.state ?? null,
          zip: prop?.zip ?? null,
          mailingAddress: owner?.address ?? null,
          mailingCity: owner?.city ?? null,
          mailingState: owner?.state ?? null,
          mailingZip: owner?.zip ?? null,
          source,
          tags: ["MyPlusLeads", status],
          description: listing.propertyDetails?.remarks ?? null,
          miscValues: Object.keys(miscValues).length > 0 ? miscValues : undefined,
        },
      });

      await prisma.contactList.update({
        where: { id: list.id },
        data: { contactIds: { push: newContact.id } },
      });

      imported++;

      // Collect phones from contact1, contact2, and augmented data sets
      const lineTypeToPhoneType = (lt?: string | null) =>
        lt === "M" ? PhoneType.MOBILE : PhoneType.TELEPHONE;

      const phoneEntries: { number: string; type: PhoneType }[] = [];
      const seen = new Set<string>();
      const addPhone = (number?: string | null, lineType?: string | null) => {
        const n = number?.replace(/\D/g, "");
        if (n && n.length >= 10 && !seen.has(n)) {
          seen.add(n);
          phoneEntries.push({ number: n, type: lineTypeToPhoneType(lineType) });
        }
      };

      addPhone(contact1.phone1);
      addPhone(contact1.phone2);
      addPhone(listing.contact2?.phone1);
      addPhone(listing.contact2?.phone2);

      for (const aug of [listing.augmentedData1, listing.augmentedData2, listing.augmentedData3, listing.augmentedData4, listing.augmentedData5]) {
        if (!aug) continue;
        addPhone(aug.augmentedPhone1, aug.lineType1);
        addPhone(aug.augmentedPhone2, aug.lineType2);
        addPhone(aug.augmentedPhone3, aug.lineType3);
        addPhone(aug.augmentedPhone4, aug.lineType4);
      }

      if (phoneEntries.length > 0) {
        await prisma.contactPhone.createMany({
          data: phoneEntries.map((p) => ({ contactId: newContact.id, number: p.number, type: p.type })),
          skipDuplicates: true,
        });
      }

      // Collect emails from contact1, contact2, and augmented data
      const emailEntries: string[] = [];
      const seenEmails = new Set<string>();
      const addEmail = (email?: string | null) => {
        if (email && email.includes("@") && !seenEmails.has(email.toLowerCase())) {
          seenEmails.add(email.toLowerCase());
          emailEntries.push(email);
        }
      };

      addEmail(contact1.email);
      addEmail(listing.contact2?.email);
      for (const aug of [listing.augmentedData1, listing.augmentedData2, listing.augmentedData3, listing.augmentedData4, listing.augmentedData5]) {
        if (!aug) continue;
        addEmail(aug.augmentedEmail1);
        addEmail(aug.augmentedEmail2);
        addEmail(aug.augmentedEmail3);
      }

      if (emailEntries.length > 0) {
        await prisma.contactEmail.createMany({
          data: emailEntries.map((email, i) => ({ contactId: newContact.id, email, isPrimary: i === 0 })),
          skipDuplicates: true,
        });
      }
    }
  }

  await prisma.myPlusLeadsConfig.update({
    where: { id: config.id },
    data: { lastSyncAt: new Date(), errorMessage: null },
  });
  await prisma.leadStore.update({
    where: { id: leadStoreId },
    data: { lastSyncAt: new Date(), syncErrorMessage: null },
  });

  return {
    fetched: listings.length,
    imported,
    skipped,
  };
}

/**
 * Manual repair — for each MPL-tagged contact this user owns, put it back
 * into the top-level ContactList named after its status tag (creating the
 * list if missing). Intended for the admin "Repair MPL Lists" action, NEVER
 * called from the automatic sync — because after a lead is imported, list
 * membership belongs to the user (they may have removed it on purpose).
 * Additive: nothing is removed from any other list.
 */
export type MyPlusLeadsRepairResult = { status: string; tagged: number; added: number; alreadyIn: number }[];

export async function repairListMembershipForUser(userId: string): Promise<MyPlusLeadsRepairResult> {
  const STATUS_TAGS = ["Expired", "Withdrawn", "Canceled", "FSBO", "FRBO", "PreForclosure", "PreForeclosure"];
  const result: MyPlusLeadsRepairResult = [];
  const cache = new Map<string, { id: string; contactIds: string[] }>();

  const getList = async (name: string) => {
    if (cache.has(name)) return cache.get(name)!;
    let list = await prisma.contactList.findFirst({
      where: { userId, name, folderId: null },
      select: { id: true, contactIds: true },
    });
    if (!list) {
      list = await prisma.contactList.create({
        data: { name, userId, contactIds: [] },
        select: { id: true, contactIds: true },
      });
    }
    const entry = { id: list.id, contactIds: [...(list.contactIds as string[])] };
    cache.set(name, entry);
    return entry;
  };

  for (const status of STATUS_TAGS) {
    const tagged = await prisma.contact.findMany({
      where: { userId, tags: { has: status } },
      select: { id: true },
    });
    if (tagged.length === 0) continue;
    const list = await getList(status);
    const memberSet = new Set(list.contactIds);
    const toAdd: string[] = [];
    let alreadyIn = 0;
    for (const c of tagged) {
      if (memberSet.has(c.id)) alreadyIn++;
      else toAdd.push(c.id);
    }
    if (toAdd.length > 0) {
      await prisma.contactList.update({
        where: { id: list.id },
        data: { contactIds: { push: toAdd } },
      });
      for (const id of toAdd) list.contactIds.push(id);
    }
    result.push({ status, tagged: tagged.length, added: toAdd.length, alreadyIn });
  }
  return result;
}

/**
 * Syncs every ACTIVE, package-assigned Lead Store purchase for this user
 * (there can be more than one, e.g. a different account/package per
 * purchased list type).
 */
export async function syncLeadsForUser(userId: string): Promise<MyPlusLeadsSyncResult> {
  const leadStores = await prisma.leadStore.findMany({
    where: { userId, status: "ACTIVE", myPlusLeadsConfigId: { not: null }, assignedPackage: { not: null } },
  });

  if (leadStores.length === 0) {
    throw new MyPlusLeadsError("No active, package-assigned MyPlusLeads purchase found for this user.", 400);
  }

  const totals: MyPlusLeadsSyncResult = { fetched: 0, imported: 0, skipped: 0 };
  for (const leadStore of leadStores) {
    const result = await syncLeadsForLeadStore(leadStore.id);
    totals.fetched += result.fetched;
    totals.imported += result.imported;
    totals.skipped += result.skipped;
  }
  return totals;
}

/**
 * Registers a MyPlusLeads account Client already created directly on MyPlusLeads'
 * platform — validates the credentials against MyPlusLeads, then stores them.
 * This never calls MyPlusLeads' account-creation API; it only records an account
 * that already exists there. Not tied to any purchase yet — link it to one
 * afterward via linkMyPlusLeadsAccount.
 */
export async function registerMyPlusLeadsAccount(params: {
  userId: string;
  adminUserId: string;
  subAccountEmail: string;
  subAccountPassword: string;
  subAccountId?: string;
  label?: string;
}) {
  await authenticateSubAccount(params.subAccountEmail, params.subAccountPassword);

  return prisma.myPlusLeadsConfig.create({
    data: {
      userId: params.userId,
      label: params.label ?? null,
      subAccountEmail: params.subAccountEmail,
      subAccountPassword: encrypt(params.subAccountPassword),
      subAccountId: params.subAccountId ?? null,
      status: "CONNECTED",
      linkedByUserId: params.adminUserId,
      linkedAt: new Date(),
    },
  });
}

/**
 * Fixes a mis-entered credential on an already-registered MyPlusLeads
 * account (e.g. the wrong password was typed in). Re-validates against
 * MyPlusLeads before saving whichever fields are provided.
 */
export async function updateMyPlusLeadsAccount(
  configId: string,
  params: { subAccountEmail?: string; subAccountPassword?: string; subAccountId?: string; label?: string },
) {
  const existing = await prisma.myPlusLeadsConfig.findUnique({ where: { id: configId } });
  if (!existing) {
    throw new MyPlusLeadsError("MyPlusLeads account not found.", 404);
  }

  const email = params.subAccountEmail ?? existing.subAccountEmail;
  const password = params.subAccountPassword ?? (existing.subAccountPassword ? decrypt(existing.subAccountPassword) : undefined);

  if (params.subAccountEmail || params.subAccountPassword) {
    if (!email || !password) {
      throw new MyPlusLeadsError("Both email and password are required to update credentials.", 400);
    }
    await authenticateSubAccount(email, password);
  }

  return prisma.myPlusLeadsConfig.update({
    where: { id: configId },
    data: {
      ...(params.subAccountEmail ? { subAccountEmail: params.subAccountEmail } : {}),
      ...(params.subAccountPassword ? { subAccountPassword: encrypt(params.subAccountPassword) } : {}),
      ...(params.subAccountId !== undefined ? { subAccountId: params.subAccountId || null } : {}),
      ...(params.label !== undefined ? { label: params.label || null } : {}),
      status: "CONNECTED",
      errorMessage: null,
    },
  });
}

/**
 * Links an already-registered MyPlusLeads account — and one specific data
 * package on it — to a customer's Lead Store purchase, flips it to ACTIVE,
 * un-pauses billing if needed, and syncs just that package.
 */
export async function linkMyPlusLeadsAccount(params: {
  leadStoreId: string;
  adminUserId: string;
  myPlusLeadsConfigId: string;
  assignedPackage: string;
}): Promise<MyPlusLeadsSyncResult> {
  const leadStore = await prisma.leadStore.findUnique({ where: { id: params.leadStoreId } });
  if (!leadStore) {
    throw new MyPlusLeadsError("Lead Store purchase not found.", 404);
  }

  const existing = await prisma.myPlusLeadsConfig.findUnique({ where: { id: params.myPlusLeadsConfigId } });
  if (!existing) {
    throw new MyPlusLeadsError("MyPlusLeads account not found.", 404);
  }

  await prisma.myPlusLeadsConfig.update({
    where: { id: params.myPlusLeadsConfigId },
    data: { status: "CONNECTED", errorMessage: null, linkedByUserId: params.adminUserId, linkedAt: new Date() },
  });

  await prisma.leadStore.update({
    where: { id: params.leadStoreId },
    data: { myPlusLeadsConfigId: params.myPlusLeadsConfigId, assignedPackage: params.assignedPackage, status: "ACTIVE" },
  });

  if (leadStore.billingPaused && leadStore.stripeSubscriptionId) {
    await getStripeClient().subscriptions.update(leadStore.stripeSubscriptionId, { pause_collection: null });
    await prisma.leadStore.update({ where: { id: params.leadStoreId }, data: { billingPaused: false } });
  }

  return syncLeadsForLeadStore(params.leadStoreId);
}

