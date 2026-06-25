import crypto from "crypto";
import { envConfig } from "../lib/config";
import prisma from "../lib/prisma";
import { decryptEIN as decrypt, encryptEIN as encrypt } from "../utils/encryption";
import { chunkArray } from "@/utils/helpers";
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

function requireConfig(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export async function authenticateEnterprise(): Promise<string> {
  const url = `${BASE_URL}/authenticate`;
  const method = "POST";
  const headers = { "Content-Type": "application/json" };
  const body = JSON.stringify({
    email: requireConfig(envConfig.MYPLUSLEADS_ENTERPRISE_EMAIL, "MYPLUSLEADS_ENTERPRISE_EMAIL"),
    password: requireConfig(envConfig.MYPLUSLEADS_ENTERPRISE_PASSWORD, "MYPLUSLEADS_ENTERPRISE_PASSWORD"),
  });

  console.log("[MyPlusLeads] authenticateEnterprise request:");
  console.log("  URL:", url);
  console.log("  Method:", method);
  console.log("  Headers:", headers);
  console.log("  Body:", body);

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  const authToken = await parseAuthResponse(res, "MyPlusLeads auth");
  if (!authToken) {
    throw new MyPlusLeadsError("MyPlusLeads auth response did not include an auth token.", 502);
  }

  return authToken;
}

export async function authenticateSubAccount(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/authenticate`, {
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
  const authToken = await authenticateSubAccount(subEmail, subPassword);

  // MPL requires the token as a query param — Authorization header returns 401.
  const res = await fetch(`${BASE_URL}/listings?authToken=${encodeURIComponent(authToken)}`);

  if (!res.ok) {
    throw new MyPlusLeadsError(`MyPlusLeads listings fetch failed: ${await responseErrorMessage(res)}`, 502);
  }

  const data = await res.json();
  return data.listings ?? [];
}

export async function fetchListingsForAccount(subAccountId: string): Promise<MyPlusLead[]> {
  const authToken = await authenticateEnterprise();

  // MPL requires the token as a query param. Enterprise token returns all listings;
  // used only as a fallback when sub-account credentials are unavailable.
  const res = await fetch(`${BASE_URL}/listings?authToken=${encodeURIComponent(authToken)}`);

  if (!res.ok) {
    throw new MyPlusLeadsError(`MyPlusLeads listings fetch failed: ${await responseErrorMessage(res)}`, 502);
  }

  const data = await res.json();
  return data.listings ?? [];
}

export async function syncLeadsForUser(userId: string): Promise<MyPlusLeadsSyncResult> {
  const config = await prisma.myPlusLeadsConfig.findUnique({ where: { userId } });

  if (!config) {
    throw new MyPlusLeadsError("MyPlusLeads integration is not configured for this user.", 400);
  }

  if (config.status !== "CONNECTED") {
    throw new MyPlusLeadsError(`MyPlusLeads integration is not connected. Current status: ${config.status}.`, 400);
  }

  if (!config.subAccountEmail || !config.subAccountPassword) {
    throw new MyPlusLeadsError("MyPlusLeads sub-account credentials are missing for this user.", 400);
  }

  const password = decrypt(config.subAccountPassword);

  const listings = await fetchListings(config.subAccountEmail, password);
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

  for (const listingChunk of chunkArray(listings, 50)) {
    for (const listing of listingChunk) {
      const contact1 = listing.contact1;
      if (!contact1?.name) {
        skipped++;
        continue;
      }

      const source = listing.propertyDetails?.mlsNumber ?? String(listing.listingId);
      const existing = await prisma.contact.findFirst({ where: { userId, source } });
      if (existing) {
        skipped++;
        continue;
      }

      const status = listing.propertyDetails?.normalizedStatus ?? listing.propertyDetails?.status ?? "Expired";
      const prop = listing.propertyAddress;
      const owner = listing.owner;
      const list = await getOrCreateList(status);

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
    where: { userId },
    data: { lastSyncAt: new Date(), errorMessage: null },
  });

  return {
    fetched: listings.length,
    imported,
    skipped,
  };
}

export async function createMyPlusLeadsAccount(params: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  baseZip: string;
}): Promise<{ accountId: string }> {
  const authToken = await authenticateEnterprise();

  const res = await fetch(`${BASE_URL}/enterprise/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authToken,
      email: params.email,
      password: params.password,
      firstName: params.firstName,
      lastName: params.lastName,
      phone: params.phone,
      address: params.address,
      city: params.city,
      state: params.state,
      zip: params.zip,
      baseZip: params.baseZip,
      bundle: requireConfig(envConfig.MYPLUSLEADS_BUNDLE_NAME, "MYPLUSLEADS_BUNDLE_NAME"),
      subscriptionType: "MONTHLY",
    }),
  });

  if (!res.ok) {
    throw new MyPlusLeadsError(`MyPlusLeads account creation failed: ${await responseErrorMessage(res)}`, 502);
  }

  const data = await res.json();
  console.log('[MyPlusLeads] Create account response status:', res.status);
  console.log('[MyPlusLeads] Create account response body:', JSON.stringify(data));

  // MPL returns HTTP 200 even when creation fails — check the payload.
  if (data.created === false) {
    throw new MyPlusLeadsError(
      `MyPlusLeads account already exists or creation rejected: ${data.error ?? "unknown"}`,
      409,
    );
  }

  return { accountId: data.accountId };
}

/**
 * Repair a broken MyPlusLeads integration for a user.
 *
 * Handles two cases:
 *  1. status=FAILED / missing credentials — account may exist in MPL but
 *     credentials were never saved (e.g. due to the Int→String Prisma bug).
 *  2. status=CONNECTED but auth fails — stored password doesn't match MPL.
 *
 * Strategy: re-create the sub-account using the enterprise API with a fresh
 * password. MPL uses the email as the unique key, so if the account already
 * exists it may return an error — in that case we try updating the password
 * via the enterprise update endpoint. After credentials are saved we run an
 * immediate sync.
 */
export async function repairAndSyncUser(userId: string): Promise<MyPlusLeadsSyncResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true },
  });
  if (!user) throw new MyPlusLeadsError("User not found.", 404);

  const subEmail = `slingvo.${userId.replace(/-/g, "")}@slingvo.com`;
  const newPassword = crypto.randomBytes(12).toString("hex");
  const nameParts = (user.fullName?.trim().split(/\s+/).filter(Boolean)) ?? ["User"];
  const firstName = nameParts[0] || "User";
  const lastName = nameParts.slice(1).join(" ") || "User";
  const defaultBaseZip = envConfig.MYPLUSLEADS_DEFAULT_BASE_ZIP || "78701";

  let accountId: string;
  let passwordToSave = newPassword;
  let passwordChanged = true;

  try {
    const result = await createMyPlusLeadsAccount({
      email: subEmail,
      password: newPassword,
      firstName,
      lastName,
      phone: "0000000000",
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: defaultBaseZip,
      baseZip: defaultBaseZip,
    });
    accountId = String(result.accountId);
    console.log(`[MyPlusLeads Repair] Created new sub-account for userId=${userId}, accountId=${accountId}`);
  } catch (createErr: any) {
    // Account already exists — retrieve the existing accountId from DB.
    console.warn(`[MyPlusLeads Repair] Create failed (${createErr.message}), account exists. Attempting password update...`);
    const existing = await prisma.myPlusLeadsConfig.findUnique({
      where: { userId },
      select: { subAccountId: true, subAccountPassword: true },
    });
    if (!existing?.subAccountId || existing.subAccountId === "null") {
      throw new MyPlusLeadsError("Cannot repair: no valid subAccountId on record.", 400);
    }
    accountId = existing.subAccountId;

    // Try to update the password on MyPlus.
    const authToken = await authenticateEnterprise();
    const updateRes = await fetch(`${BASE_URL}/enterprise/account`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authToken, accountId, password: newPassword }),
    });

    if (!updateRes.ok) {
      // Password update not supported — keep using the existing stored password
      // so we don't drift the DB out of sync with MyPlus.
      console.warn(`[MyPlusLeads Repair] Password update failed (${await responseErrorMessage(updateRes)}). Keeping existing credentials.`);
      passwordToSave = existing.subAccountPassword ? decrypt(existing.subAccountPassword) : newPassword;
      passwordChanged = false;
    } else {
      console.log(`[MyPlusLeads Repair] Password updated for accountId=${accountId}`);
    }
  }

  await prisma.myPlusLeadsConfig.upsert({
    where: { userId },
    create: {
      userId,
      subAccountEmail: subEmail,
      subAccountPassword: encrypt(passwordToSave),
      subAccountId: accountId,
      status: "CONNECTED",
      errorMessage: null,
    },
    update: {
      subAccountEmail: subEmail,
      subAccountPassword: encrypt(passwordToSave),
      subAccountId: accountId,
      status: "CONNECTED",
      errorMessage: null,
    },
  });

  console.log(`[MyPlusLeads Repair] Credentials saved for userId=${userId} (passwordChanged=${passwordChanged}). Starting sync...`);
  return syncLeadsForUser(userId);
}

export async function disableMyPlusLeadsAccount(subAccountId: string): Promise<void> {
  const authToken = await authenticateEnterprise();

  const res = await fetch(`${BASE_URL}/enterprise/account/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authToken,
      accountId: subAccountId,
      status: "DISABLED",
    }),
  });

  if (!res.ok) {
    throw new MyPlusLeadsError(`MyPlusLeads disable failed: ${await responseErrorMessage(res)}`, 502);
  }
}
