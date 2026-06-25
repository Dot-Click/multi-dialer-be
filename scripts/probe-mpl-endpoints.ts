import prisma from "../src/lib/prisma";

const BASE_URL = "https://api.myplusleads.com";
const ACCOUNT_ID = "52573";

async function authenticateEnterprise(): Promise<string> {
  const res = await fetch(`${BASE_URL}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.MYPLUSLEADS_ENTERPRISE_EMAIL,
      password: process.env.MYPLUSLEADS_ENTERPRISE_PASSWORD,
    }),
  });
  const data = await res.json();
  const token = data?.authenticatedToken ?? data?.authToken ?? data?.token ?? data?.accessToken ?? data?.access_token ?? data?.data?.token;
  if (!token) throw new Error("No enterprise token: " + JSON.stringify(data));
  return token;
}

async function probe(label: string, method: string, url: string, body?: any) {
  try {
    const opts: any = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    console.log(`[${label}] ${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  } catch (e: any) {
    console.log(`[${label}] ERROR: ${e.message}`);
  }
}

async function main() {
  const authToken = await authenticateEnterprise();
  console.log("Enterprise auth OK\n--- Listings probe ---");

  // Try fetching listings with enterprise token different ways
  await probe("listings Bearer header", "GET", `${BASE_URL}/listings`, undefined);
  await probe("listings ?authToken=", "GET", `${BASE_URL}/listings?authToken=${authToken}`, undefined);
  await probe("listings POST body", "POST", `${BASE_URL}/listings`, { authToken });
  await probe("enterprise/listings ?authToken=", "GET", `${BASE_URL}/enterprise/listings?authToken=${authToken}&accountId=${ACCOUNT_ID}`, undefined);
  await probe("enterprise/listings POST", "POST", `${BASE_URL}/enterprise/listings`, { authToken, accountId: ACCOUNT_ID });

  console.log("\n--- Account management probe ---");
  await probe("GET /enterprise/account", "GET", `${BASE_URL}/enterprise/account?authToken=${authToken}&accountId=${ACCOUNT_ID}`, undefined);
  await probe("DELETE /enterprise/account", "DELETE", `${BASE_URL}/enterprise/account`, { authToken, accountId: ACCOUNT_ID });
  await probe("POST /enterprise/account/status DISABLED", "PUT", `${BASE_URL}/enterprise/account/status`, { authToken, accountId: ACCOUNT_ID, status: "DISABLED" });
}

main().catch(console.error).finally(() => prisma.$disconnect());
