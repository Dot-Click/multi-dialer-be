import crypto from "crypto";
import prisma from "../src/lib/prisma";
import { authenticateSubAccount, createMyPlusLeadsAccount, syncLeadsForUser } from "../src/services/myPlusLeads.service";
import { encryptEIN as encrypt } from "../src/utils/encryption";

const email = process.argv[2] || "development@gmail.com";

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  console.log(`Forcing fresh sub-account for: ${user.email} (${user.id})`);

  // Use a versioned email suffix to bypass "account already exists" since the
  // original account's password was lost to credential drift.
  const baseId = user.id.replace(/-/g, "");
  let accountId: string | null = null;
  let subEmail = "";
  let newPassword = "";

  for (let v = 2; v <= 9; v++) {
    subEmail = `slingvo.${baseId}v${v}@slingvo.com`;
    newPassword = crypto.randomBytes(12).toString("hex");
    console.log(`Trying email: ${subEmail}`);
    try {
      const result = await createMyPlusLeadsAccount({
        email: subEmail,
        password: newPassword,
        firstName: user.fullName?.split(" ")[0] || "User",
        lastName: user.fullName?.split(" ").slice(1).join(" ") || "User",
        phone: "0000000000",
        address: "123 Main St",
        city: "Austin",
        state: "TX",
        zip: process.env.MYPLUSLEADS_DEFAULT_BASE_ZIP || "78701",
        baseZip: process.env.MYPLUSLEADS_DEFAULT_BASE_ZIP || "78701",
      });
      accountId = String(result.accountId);
      console.log(`Created accountId=${accountId} with email=${subEmail}`);
      break;
    } catch (e: any) {
      console.warn(`  ${subEmail} failed: ${e.message}`);
    }
  }

  if (!accountId) throw new Error("Could not create a fresh sub-account after several attempts.");

  // Verify sub-account auth works before saving
  console.log("Verifying sub-account auth...");
  const token = await authenticateSubAccount(subEmail, newPassword);
  console.log("Auth OK, token length:", token.length);

  await prisma.myPlusLeadsConfig.upsert({
    where: { userId: user.id },
    create: { userId: user.id, subAccountEmail: subEmail, subAccountPassword: encrypt(newPassword), subAccountId: accountId, status: "CONNECTED", errorMessage: null },
    update: { subAccountEmail: subEmail, subAccountPassword: encrypt(newPassword), subAccountId: accountId, status: "CONNECTED", errorMessage: null },
  });
  console.log("Credentials saved. Starting sync...");

  const result = await syncLeadsForUser(user.id);
  console.log("Sync complete:", result);
}

main()
  .catch((err) => {
    console.error("Script failed:", err?.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
