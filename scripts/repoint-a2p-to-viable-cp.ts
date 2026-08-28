/**
 * One-shot repair: point a user's A2P row back at an existing in-review /
 * approved CP that was orphaned by a duplicate-CP resubmit. Also deletes
 * the auto-rejected duplicate on Twilio so it can't confuse future runs.
 *
 * Usage:
 *   npx tsx scripts/repoint-a2p-to-viable-cp.ts \
 *     <userIdOrEmail> <viableCpSid> <rejectedDuplicateCpSid>
 */
import prisma from "../src/lib/prisma";
import twilio from "twilio";

async function main() {
  const [, , userArg, viableSid, rejectedSid] = process.argv;
  if (!userArg || !viableSid || !rejectedSid) {
    console.error("Usage: npx tsx scripts/repoint-a2p-to-viable-cp.ts <userIdOrEmail> <viableCpSid> <rejectedDuplicateCpSid>");
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

  console.log(`[repoint] Repointing user ${user.email} A2P row to CP ${viableSid}.`);
  console.log(`[repoint] Deleting duplicate rejected CP ${rejectedSid} on Twilio (best-effort).`);

  try {
    await client.trusthub.v1.customerProfiles(rejectedSid).remove();
    console.log(`[repoint] Deleted rejected CP ${rejectedSid}.`);
  } catch (err: any) {
    console.warn(`[repoint] Could not delete rejected CP ${rejectedSid}: ${err.message}`);
  }

  const updated = await prisma.a2P_Registration.update({
    where: { userId: user.id },
    data: {
      customerProfileSid: viableSid,
      brandSid: null,
      messagingServiceSid: null,
      campaignSid: null,
      status: "PENDING",
      rejectionReason: null,
      customerProfileApproved: false, // will flip true when the CP approves
    },
  });
  console.log("[repoint] DB updated:", updated);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
