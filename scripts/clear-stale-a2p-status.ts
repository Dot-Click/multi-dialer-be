/**
 * One-shot: runs checkA2PStatus for a specific user, which reconciles the
 * local A2P row against Twilio's current bundle+brand state. Fires the same
 * code path as GET /api/a2p/status without needing an authenticated request.
 *
 * Usage:
 *   npx tsx scripts/clear-stale-a2p-status.ts <userIdOrEmail>
 */

import prisma from "../src/lib/prisma";
import { a2pRegistrationService } from "../src/services/a2pRegistrationService";

async function main() {
  const [, , userArg] = process.argv;
  if (!userArg) {
    console.error("Usage: npx tsx scripts/clear-stale-a2p-status.ts <userIdOrEmail>");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: userArg.includes("@") ? { email: userArg } : { id: userArg },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`No user found matching "${userArg}".`);

  console.log(`[clear] Reconciling A2P status for ${user.email} (${user.id})...`);

  const before = await prisma.a2P_Registration.findUnique({
    where: { userId: user.id },
    select: { status: true, rejectionReason: true, customerProfileSid: true, brandSid: true, customerProfileApproved: true },
  });
  console.log("[clear] Before:", before);

  const result = await a2pRegistrationService.checkA2PStatus(user.id);
  console.log("[clear] checkA2PStatus returned:", result);

  const after = await prisma.a2P_Registration.findUnique({
    where: { userId: user.id },
    select: { status: true, rejectionReason: true, customerProfileSid: true, brandSid: true, customerProfileApproved: true },
  });
  console.log("[clear] After:", after);
}

main()
  .catch((err) => {
    console.error("[clear] FAILED:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
