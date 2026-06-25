import crypto from "crypto";
import { envConfig } from "../lib/config";
import prisma from "../lib/prisma";
import { decryptEIN as decrypt, encryptEIN as encrypt } from "../utils/encryption";
import { chunkArray } from "@/utils/helpers";
import { PhoneType } from "@prisma/client";

const BASE_URL = "https://api.myplusleads.com";

export interface MyPlusLead {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ownerAddress?: string;
  ownerCity?: string;
  ownerState?: string;
  ownerZip?: string;
  estimatedValue?: number;
  mlsNumber?: string;
  contacts: Array<{
    firstName: string;
    lastName: string;
    phones: Array<{ number: string; type: string }>;
    emails: string[];
  }>;
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

  const res = await fetch(`${BASE_URL}/listings`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!res.ok) {
    throw new MyPlusLeadsError(`MyPlusLeads listings fetch failed: ${await responseErrorMessage(res)}`, 502);
  }

  const data = await res.json();
  return data.listings ?? [];
}

export async function fetchListingsForAccount(subAccountId: string): Promise<MyPlusLead[]> {
  const authToken = await authenticateEnterprise();

  // Enterprise-scoped endpoint — mirrors the pattern of all other enterprise
  // management calls (/enterprise/account, /enterprise/account/status).
  // The plain /listings endpoint only accepts sub-account tokens.
  const url = `${BASE_URL}/enterprise/listings?accountId=${subAccountId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!res.ok) {
    throw new MyPlusLeadsError(`MyPlusLeads enterprise listings fetch failed: ${await responseErrorMessage(res)}`, 502);
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

  let listings: MyPlusLead[];
  try {
    listings = await fetchListings(config.subAccountEmail, password);
  } catch (err: any) {
    if (!config.subAccountId) throw err;
    console.warn(`[MyPlusLeads] fetchListings failed (${err.message}), retrying via fetchListingsForAccount`);
    listings = await fetchListingsForAccount(config.subAccountId);
  }
  let imported = 0;
  let skipped = 0;

  for (const listingChunk of chunkArray(listings, 50)) {
    // FIX: keep the sync moving in batches while avoiding a giant burst of DB writes.
    for (const listing of listingChunk) {
      const primaryContact = listing.contacts[0];
      if (!primaryContact) {
        skipped++;
        continue;
      }

      const source = listing.mlsNumber ?? listing.id;
      const existing = await prisma.contact.findFirst({
        where: { userId, source },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const fullName = `${primaryContact.firstName} ${primaryContact.lastName}`.trim() || "Unknown Contact";

      const newContact = await prisma.contact.create({
        data: {
          fullName,
          userId,
          address: listing.address,
          city: listing.city,
          state: listing.state,
          zip: listing.zip,
          mailingAddress: listing.ownerAddress,
          mailingCity: listing.ownerCity,
          mailingState: listing.ownerState,
          mailingZip: listing.ownerZip,
          source,
          tags: ["MyPlusLeads", "Expired"],
        },
      });
      imported++;

      const phoneRows = [
        ...primaryContact.phones.map((phone) => ({
          contactId: newContact.id,
          number: phone.number,
          type: phone.type === "mobile" ? PhoneType.MOBILE : PhoneType.TELEPHONE,
        })),
        ...(listing.contacts[1]?.phones ?? []).map((phone) => ({
          contactId: newContact.id,
          number: phone.number,
          type: phone.type === "mobile" ? PhoneType.MOBILE : PhoneType.TELEPHONE,
        })),
      ];

      if (phoneRows.length > 0) {
        await prisma.contactPhone.createMany({ data: phoneRows, skipDuplicates: true });
      }

      const emailRows = primaryContact.emails.map((email, index) => ({
        contactId: newContact.id,
        email,
        isPrimary: index === 0,
      }));

      if (emailRows.length > 0) {
        await prisma.contactEmail.createMany({ data: emailRows, skipDuplicates: true });
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

  try {
    // Try creating the account (will succeed if it doesn't exist yet, or if MPL
    // allows re-creation with the same email under the enterprise).
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
    // Account likely already exists — try updating the password via enterprise
    console.warn(`[MyPlusLeads Repair] Create failed (${createErr.message}), trying enterprise password update...`);
    const authToken = await authenticateEnterprise();
    const existing = await prisma.myPlusLeadsConfig.findUnique({ where: { userId }, select: { subAccountId: true } });
    if (!existing?.subAccountId) throw new MyPlusLeadsError("Cannot repair: no subAccountId on record.", 400);
    accountId = existing.subAccountId;

    const updateRes = await fetch(`${BASE_URL}/enterprise/account`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authToken, accountId, password: newPassword }),
    });
    if (!updateRes.ok) {
      const msg = await responseErrorMessage(updateRes);
      throw new MyPlusLeadsError(`Enterprise password update failed: ${msg}`, 502);
    }
    console.log(`[MyPlusLeads Repair] Password updated for accountId=${accountId}`);
  }

  // Save the fresh credentials to DB — upsert so it works for both FAILED and CONNECTED states
  await prisma.myPlusLeadsConfig.upsert({
    where: { userId },
    create: {
      userId,
      subAccountEmail: subEmail,
      subAccountPassword: encrypt(newPassword),
      subAccountId: accountId,
      status: "CONNECTED",
      errorMessage: null,
    },
    update: {
      subAccountEmail: subEmail,
      subAccountPassword: encrypt(newPassword),
      subAccountId: accountId,
      status: "CONNECTED",
      errorMessage: null,
    },
  });

  console.log(`[MyPlusLeads Repair] Credentials saved for userId=${userId}. Starting sync...`);
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
