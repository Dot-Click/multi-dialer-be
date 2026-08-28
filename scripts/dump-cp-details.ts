/**
 * Dump the full JSON of a Customer Profile bundle — used to find manual-
 * review rejection reasons that aren't visible in the evaluations block.
 * Usage: npx tsx scripts/dump-cp-details.ts <bundleSid> <userIdOrEmail>
 */
import prisma from "../src/lib/prisma";
import twilio from "twilio";

async function main() {
  const [, , sid, userArg] = process.argv;
  if (!sid || !userArg) {
    console.error("Usage: npx tsx scripts/dump-cp-details.ts <bundleSid> <userIdOrEmail>");
    process.exit(1);
  }
  const user = await prisma.user.findFirst({
    where: userArg.includes("@") ? { email: userArg } : { id: userArg },
  });
  if (!user) throw new Error(`No user matching "${userArg}".`);
  const integration = await prisma.integration.findFirst({
    where: { systemSetting: { userId: user.id }, provider: "TWILIO" },
    select: { credentials: true },
  });
  const creds = integration?.credentials as any;
  const client = twilio(creds.accountSid, creds.authToken);

  const profile: any = await client.trusthub.v1.customerProfiles(sid).fetch();
  console.log("=== FULL CUSTOMER PROFILE JSON ===");
  console.log(JSON.stringify(profile, null, 2));

  // Some SDKs stash rejection details on a separate resource.
  try {
    const evals: any[] = await client.trusthub.v1.customerProfiles(sid).customerProfilesEvaluations.list({ limit: 5 });
    console.log("\n=== ALL EVALUATIONS RAW ===");
    for (const e of evals) console.log(JSON.stringify(e, null, 2));
  } catch (err: any) {
    console.warn("Could not fetch evaluations:", err.message);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
