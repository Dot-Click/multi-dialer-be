/**
 * Seed two test admins that exercise the Voice Integrity fallback: VI stays
 * unlocked / approved even when the A2P row is REJECTED (Brand-side rejection
 * shouldn't gate branded voice). Also seeds a PENDING variant so both A2P
 * states can be viewed side-by-side in the DeliverabilityPanel.
 *
 * Neither user has a real Twilio subaccount — the TWILIO integration row
 * holds fake credentials so `resolveTwilioContext` takes the subaccount
 * branch (which reads only DB, never calls Twilio) in getStatus. Do NOT
 * click any button in the modal that fires POST /voice-integrity/refresh
 * for these users — that path DOES hit Twilio and will fail with fake creds.
 *
 * Idempotent: re-running deletes the seeded users' A2P / Integration /
 * CallerId rows (via cascade) and re-creates them.
 *
 * Usage:
 *   npx tsx scripts/seed-vi-fallback-test.ts
 *
 * Login:
 *   vi-test-rejected@slingvo.test / VITest!2026   (A2P status: REJECTED)
 *   vi-test-pending@slingvo.test  / VITest!2026   (A2P status: PENDING)
 */

import bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";

const PASSWORD = "VITest!2026";

interface Variant {
  email: string;
  fullName: string;
  a2pStatus: "REJECTED" | "PENDING";
  a2pRejectionReason: string | null;
  // Suffixes make the fake SIDs distinguishable per variant if you inspect
  // the DB or Redux state directly.
  suffix: string;
}

const VARIANTS: Variant[] = [
  {
    email: "vi-test-rejected@slingvo.test",
    fullName: "VI Fallback Test — REJECTED A2P",
    a2pStatus: "REJECTED",
    a2pRejectionReason:
      "Brand rejected: TCR flagged campaign use case as non-compliant. " +
      "This is a fake seeded rejection to verify VI unlocks despite Brand failure.",
    suffix: "REJ",
  },
  {
    email: "vi-test-pending@slingvo.test",
    fullName: "VI Fallback Test — PENDING A2P",
    a2pStatus: "PENDING",
    a2pRejectionReason: null,
    suffix: "PEN",
  },
];

async function seedVariant(v: Variant, hashedPassword: string) {
  console.log(`\n[seed] === ${v.email} (A2P ${v.a2pStatus}) ===`);

  const existing = await prisma.user.findUnique({ where: { email: v.email } });
  if (existing) {
    console.log(`[seed] Deleting existing user ${existing.id} (cascades A2P/Integration/CallerId/…).`);
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const user = await prisma.user.create({
    data: {
      email: v.email,
      fullName: v.fullName,
      password: hashedPassword,
      role: "ADMIN",
      emailVerified: true,
      isSubscribed: true,
    },
  });
  console.log(`[seed] User created ${user.id}.`);

  // Active subscription — without this, the Dialer Access Locked wall
  // covers the settings pages. advancedDeliverabilityEnabled defaults to
  // true when no PlanLimit row matches, so we don't need to seed one.
  await prisma.userSubscription.create({
    data: {
      userId: user.id,
      plan: "premium",
      status: "ACTIVE",
      startDate: new Date("2026-01-01T00:00:00Z"),
      usersCount: 1,
    },
  });

  // Better Auth credential login row (email = accountId).
  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: v.email,
      providerId: "credential",
      password: hashedPassword,
    },
  });

  const systemSetting = await prisma.system_Setting.create({
    data: { userId: user.id },
  });

  // Fake TWILIO integration so resolveTwilioContext takes the subaccount
  // branch — the branch that reads customerProfileApproved from the DB
  // and never calls Twilio. Without this row, VI would fall through to
  // the master-account branch which calls trusthub.customerProfiles.list.
  await prisma.integration.create({
    data: {
      systemSettingId: systemSetting.id,
      provider: "TWILIO",
      status: "CONNECTED",
      credentials: {
        accountSid: `AC00000000000000000000000000${v.suffix}`,
        authToken: `fake-auth-token-${v.suffix.toLowerCase()}`,
        status: "active",
      },
    },
  });

  const customerProfileSid = `BUxxxxTEST${v.suffix}`;
  const trustProductSid = `TPxxxxTEST${v.suffix}`;
  const endUserSid = `IDxxxxTEST${v.suffix}`;
  const viAssignmentSid = `RA00000000000000000000000000${v.suffix}`;
  const numberSid = `PN00000000000000000000000000${v.suffix}`;

  // A2P row — the whole point of the fallback test:
  //   customerProfileApproved=true is what VI keys off,
  //   status=REJECTED (or PENDING) is what the A2P card shows.
  await prisma.a2P_Registration.create({
    data: {
      userId: user.id,
      legalBusinessName: v.fullName,
      businessType: "LLC",
      ein: "SEEDED-EIN-DO-NOT-USE",
      businessWebsite: "https://example.com",
      businessAddress: "1 Test St",
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
      country: "US",
      contactFirstName: "Test",
      contactLastName: "Admin",
      contactEmail: v.email,
      contactPhone: "+14155551212",
      customerProfileSid,
      // brandSid populated for REJECTED so the check-status path has
      // something to point at; null for PENDING so the "waiting on Brand"
      // path is representative.
      brandSid: v.a2pStatus === "REJECTED" ? `BN00000000000000000000000000${v.suffix}` : null,
      status: v.a2pStatus,
      rejectionReason: v.a2pRejectionReason,
      customerProfileApproved: true, // <-- the fallback gate: VI unlocks off this.
    },
  });

  // VI integration row in the fully-approved terminal state.
  await prisma.integration.create({
    data: {
      systemSettingId: systemSetting.id,
      provider: "TWILIO_VOICE_INTEGRITY",
      status: "CONNECTED",
      credentials: {
        customerProfileSid,
        trustProductSid,
        endUserSid,
        status: "twilio-approved",
        rejectionReason: null,
      },
    },
  });

  // One CallerId marked as registered with VI — mirrors the post-approval
  // caller_id.voiceIntegrityAssignmentSid population that step 7 of the
  // real onboarding would have done.
  await prisma.callerId.create({
    data: {
      label: "Seed test number",
      countryCode: "US",
      numberOfLines: 1,
      systemSettingId: systemSetting.id,
      twillioNumber: "+15550100000",
      twillioSid: numberSid,
      voiceIntegrityAssignmentSid: viAssignmentSid,
      voiceIntegrityRegistered: true,
    },
  });

  console.log(`[seed] Done. Login as ${v.email} / ${PASSWORD}.`);
  console.log(`[seed]   customerProfileSid = ${customerProfileSid}`);
  console.log(`[seed]   trustProductSid    = ${trustProductSid}`);
  console.log(`[seed]   A2P.status         = ${v.a2pStatus}`);
  console.log(`[seed]   A2P.customerProfileApproved = true (VI unlock gate)`);
}

async function main() {
  console.log(`[seed] Hashing test password (bcrypt cost 10)...`);
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  for (const v of VARIANTS) {
    await seedVariant(v, hashedPassword);
  }

  console.log(`\n[seed] Complete. Two test admins are ready.`);
  console.log(`[seed] Both use password: ${PASSWORD}`);
  console.log(`[seed]`);
  console.log(`[seed] Expected UI behavior in Deliverability & Trust:`);
  console.log(`[seed]   REJECTED user → A2P card: "Needs update" (red)   | VI card: "Approved" (green)`);
  console.log(`[seed]   PENDING user  → A2P card: "Pending review"       | VI card: "Approved" (green)`);
  console.log(`[seed]`);
  console.log(`[seed] Do NOT click "Check Status" on the VI modal for these users —`);
  console.log(`[seed] that fires POST /voice-integrity/refresh which calls Twilio for real,`);
  console.log(`[seed] and the fake accountSid/authToken above will 401.`);
}

main()
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
