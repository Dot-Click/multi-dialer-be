/**
 * Diagnose the state of an A2P Messaging Profile trust product bundle by
 * SID. Prints the bundle's status, its most recent evaluation results, and
 * the linked entity assignments — everything needed to see WHY Twilio
 * rejected (or is refusing to advance) the bundle.
 *
 * Usage:
 *   npx tsx scripts/diagnose-a2p-bundle.ts <bundleSid> [<userIdOrEmail>]
 *
 * If a userId or email is passed, the script uses that admin's subaccount
 * Twilio credentials. Otherwise it falls back to the platform master
 * credentials from env (useful when the bundle lives on master).
 */

import prisma from "../src/lib/prisma";
import twilio from "twilio";

async function resolveClient(userArg: string | undefined) {
  if (!userArg) {
    console.log("[diagnose] Using MASTER Twilio credentials from env.");
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) throw new Error("Master TWILIO_* env vars not set.");
    return twilio(sid, tok);
  }

  const user = await prisma.user.findFirst({
    where: userArg.includes("@") ? { email: userArg } : { id: userArg },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`No user found matching "${userArg}".`);
  console.log(`[diagnose] Using subaccount credentials for user ${user.email} (${user.id}).`);

  const integration = await prisma.integration.findFirst({
    where: { systemSetting: { userId: user.id }, provider: "TWILIO" },
    select: { credentials: true },
  });
  const creds = integration?.credentials as any;
  if (!creds?.accountSid || !creds?.authToken) {
    throw new Error(`User ${user.email} has no TWILIO integration credentials — falling back to master by omitting the userArg would help.`);
  }
  return twilio(creds.accountSid, creds.authToken);
}

async function main() {
  const [, , bundleSid, userArg] = process.argv;
  if (!bundleSid) {
    console.error("Usage: npx tsx scripts/diagnose-a2p-bundle.ts <bundleSid> [<userIdOrEmail>]");
    process.exit(1);
  }

  const client = await resolveClient(userArg);

  // 1) Bundle status.
  const bundle = await client.trusthub.v1.trustProducts(bundleSid).fetch();
  console.log("\n=== TRUST PRODUCT BUNDLE ===");
  console.log("SID:            ", bundle.sid);
  console.log("Friendly name:  ", bundle.friendlyName);
  console.log("Policy SID:     ", bundle.policySid);
  console.log("Status:         ", bundle.status);
  console.log("Valid until:    ", bundle.validUntil);
  console.log("Date created:   ", bundle.dateCreated);
  console.log("Date updated:   ", bundle.dateUpdated);

  // 2) Entity assignments.
  const assignments = await client.trusthub.v1
    .trustProducts(bundleSid)
    .trustProductsEntityAssignments.list({ limit: 50 });
  console.log("\n=== ENTITY ASSIGNMENTS ===");
  for (const a of assignments) {
    console.log(`- ${a.objectSid}`);
  }

  // 3) Evaluations — this is what carries the rejection reasons.
  const evals = await client.trusthub.v1
    .trustProducts(bundleSid)
    .trustProductsEvaluations.list({ limit: 10 });
  console.log("\n=== EVALUATIONS (most recent first) ===");
  if (!evals.length) {
    console.log("(no evaluations found — bundle may never have been submitted for review)");
  }
  for (const e of evals) {
    console.log(`\n--- Evaluation ${e.sid} — status: ${e.status} ---`);
    const results: any[] = (e as any).results || [];
    for (const r of results) {
      console.log(`  requirement: ${r.friendly_name || r.name || "?"}  (${r.status || "?"})`);
      const fields: any[] = r.fields || [];
      for (const f of fields) {
        const passed = f.passed === false ? "FAILED" : "passed";
        console.log(`    - [${passed}] ${f.friendly_name || f.object_field || "?"}`);
        if (f.failure_reason) console.log(`        reason: ${f.failure_reason}`);
        if (f.error_code)     console.log(`        error_code: ${f.error_code}`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error("[diagnose] FAILED:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
