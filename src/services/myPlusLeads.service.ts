import { envConfig } from "../lib/config";

const BASE_URL = "https://api.myplusleads.com";

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
