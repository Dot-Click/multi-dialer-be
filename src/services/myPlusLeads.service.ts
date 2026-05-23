import { envConfig } from "../lib/config";
import prisma from "../lib/prisma";
import { decryptEIN as decrypt } from "../utils/encryption";

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

function requireConfig(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export async function authenticateEnterprise(): Promise<string> {
  const res = await fetch(`${BASE_URL}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: requireConfig(envConfig.MYPLUSLEADS_ENTERPRISE_EMAIL, "MYPLUSLEADS_ENTERPRISE_EMAIL"),
      password: requireConfig(envConfig.MYPLUSLEADS_ENTERPRISE_PASSWORD, "MYPLUSLEADS_ENTERPRISE_PASSWORD"),
    }),
  });

  if (!res.ok) {
    throw new Error(`MyPlusLeads auth failed: ${res.status}`);
  }

  const data = await res.json();
  return data.authToken;
}

export async function authenticateSubAccount(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(`MyPlusLeads sub-account auth failed: ${res.status}`);
  }

  const data = await res.json();
  return data.authToken;
}

export async function fetchListings(subEmail: string, subPassword: string): Promise<MyPlusLead[]> {
  const authToken = await authenticateSubAccount(subEmail, subPassword);
  const res = await fetch(`${BASE_URL}/listings`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!res.ok) {
    throw new Error(`MyPlusLeads listings fetch failed: ${res.status}`);
  }

  const data = await res.json();
  return data.listings ?? [];
}

export async function syncLeadsForUser(userId: string): Promise<void> {
  const config = await prisma.myPlusLeadsConfig.findUnique({ where: { userId } });

  if (!config || config.status !== "CONNECTED" || !config.subAccountEmail || !config.subAccountPassword) {
    return;
  }

  const password = decrypt(config.subAccountPassword);
  const listings = await fetchListings(config.subAccountEmail, password);

  for (const listing of listings) {
    const primaryContact = listing.contacts[0];
    if (!primaryContact) continue;

    const source = listing.mlsNumber ?? listing.id;
    const existing = await prisma.contact.findFirst({
      where: { userId, source },
    });
    if (existing) continue;

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

    for (const phone of primaryContact.phones) {
      await prisma.contactPhone.create({
        data: {
          contactId: newContact.id,
          number: phone.number,
          type: phone.type === "mobile" ? "MOBILE" : "TELEPHONE",
        },
      });
    }

    for (let i = 0; i < primaryContact.emails.length; i++) {
      await prisma.contactEmail.create({
        data: {
          contactId: newContact.id,
          email: primaryContact.emails[i],
          isPrimary: i === 0,
        },
      });
    }

    const secondaryContact = listing.contacts[1];
    if (secondaryContact) {
      for (const phone of secondaryContact.phones) {
        await prisma.contactPhone.create({
          data: {
            contactId: newContact.id,
            number: phone.number,
            type: phone.type === "mobile" ? "MOBILE" : "TELEPHONE",
          },
        });
      }
    }
  }

  await prisma.myPlusLeadsConfig.update({
    where: { userId },
    data: { lastSyncAt: new Date(), errorMessage: null },
  });
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
    throw new Error(`MyPlusLeads account creation failed: ${res.status}`);
  }

  const data = await res.json();
  return { accountId: data.accountId };
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
    throw new Error(`MyPlusLeads disable failed: ${res.status}`);
  }
}
