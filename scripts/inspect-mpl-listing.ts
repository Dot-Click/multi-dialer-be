import prisma from "../src/lib/prisma";
import { decryptEIN as decrypt } from "../src/utils/encryption";

const BASE_URL = "https://api.myplusleads.com";

async function main() {
  const config = await prisma.myPlusLeadsConfig.findFirst({
    where: { subAccountEmail: { contains: "v2" } },
  });
  if (!config?.subAccountEmail || !config?.subAccountPassword) throw new Error("No config found");

  const password = decrypt(config.subAccountPassword);
  const authRes = await fetch(`${BASE_URL}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.subAccountEmail, password }),
  });
  const authData = await authRes.json();
  const token = authData?.authenticatedToken ?? authData?.authToken ?? authData?.token ?? authData?.accessToken;
  if (!token) throw new Error("Auth failed: " + JSON.stringify(authData));

  const res = await fetch(`${BASE_URL}/listings?authToken=${encodeURIComponent(token)}`);
  const data = await res.json();

  const first = data.listings?.[0];
  console.log("Total listings:", data.listings?.length);
  console.log("First listing (full):", JSON.stringify(first, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
