import prisma from "../lib/prisma";
import { client as masterClient } from "../lib/config";
import twilio from "twilio";

/**
 * Twilio Voice Integrity — Trust Hub enrolment for outbound caller-IDs.
 *
 * Registers each admin's phone numbers with the US carrier analytics engines
 * (T-Mobile / AT&T / Verizon) so they aren't mislabeled as "Spam Likely" on
 * the recipient's device. See:
 *   https://www.twilio.com/docs/voice/spam-monitoring-with-voiceintegrity
 *
 * Storage model (no new tables):
 *   integrations row (provider = TWILIO_VOICE_INTEGRITY) per admin, keyed
 *   by systemSettingId. credentials JSON carries the Trust Hub SIDs:
 *
 *     {
 *       customerProfileSid: "BU...",   // primary Business Profile (shared with A2P)
 *       trustProductSid:    "BU...",   // the Voice Integrity trust product itself
 *       endUserSid:         "IT...",   // voice_integrity_information end-user
 *       status:             "draft" | "pending-review" | "twilio-approved" | "twilio-rejected",
 *       rejectionReason:    string | null,
 *     }
 *
 * Voice Integrity policy SID is fixed by Twilio (documented in the Trust
 * Hub REST API guide) — it's a well-known constant, not per-account.
 */
const VOICE_INTEGRITY_POLICY_SID = "RN5b3660f9598883b1df4e77f77acefba0";

export type VoiceIntegrityStatus =
  | "not-started"
  | "draft"
  | "pending-review"
  | "twilio-approved"
  | "twilio-rejected";

export interface VoiceIntegrityCredentials {
  customerProfileSid?: string;
  trustProductSid?: string;
  endUserSid?: string;
  status: VoiceIntegrityStatus;
  rejectionReason?: string | null;
}

export interface VoiceIntegrityAttributes {
  useCase: string;                     // e.g. "sales_dialer"
  businessEmployeeCount: number;
  averageBusinessDayCallVolume: number;
  notes?: string;
}

/**
 * Fetch the Voice Integrity integration row for an admin. Returns null if
 * they've never started onboarding.
 */
async function getIntegration(adminUserId: string) {
  return prisma.integration.findFirst({
    where: {
      provider: "TWILIO_VOICE_INTEGRITY",
      systemSetting: { userId: adminUserId },
    },
  });
}

async function getSystemSettingId(adminUserId: string): Promise<string> {
  const ss = await prisma.system_Setting.findFirst({
    where: { userId: adminUserId },
    select: { id: true },
  });
  if (!ss) throw new Error(`No System_Setting for user ${adminUserId}`);
  return ss.id;
}

/**
 * Read current status for the admin. Never throws — returns "not-started"
 * for admins who haven't onboarded.
 */
export async function getStatus(adminUserId: string): Promise<VoiceIntegrityCredentials> {
  const integration = await getIntegration(adminUserId);
  if (!integration || !integration.credentials) {
    return { status: "not-started" };
  }
  return integration.credentials as unknown as VoiceIntegrityCredentials;
}

/**
 * Execute the 7-step Trust Hub sequence for a direct customer / ISV.
 * Prerequisite: the admin's Twilio subaccount already has an approved
 * primary Business Profile (created once by the A2P flow, or manually in
 * the Twilio Console). We look it up on the subaccount and reuse it.
 *
 * Steps (per Twilio docs):
 *   1. Look up the admin's primary Business Profile (customerProfileSid).
 *   2. Ensure every already-owned number is attached to that profile.
 *   3. Create a Voice Integrity TrustProduct (with the fixed policy SID).
 *   4. Create an EndUser of type voice_integrity_information.
 *   5. Link end user → trust product.
 *   6. Link business profile → trust product.
 *   7. Assign every phone number → trust product.
 *   8. Submit trust product (Status: pending-review).
 *
 * Approval takes 24–48h; refreshStatus() polls Twilio afterward.
 */
export async function submitOnboarding(
  adminUserId: string,
  attrs: VoiceIntegrityAttributes
): Promise<VoiceIntegrityCredentials> {
  const systemSettingId = await getSystemSettingId(adminUserId);

  // Voice Integrity onboarding happens against the master account (that's
  // the account the Twilio ISV model expects to own the trust products for
  // its sub-accounts). The subaccount client is only used to *list* the
  // numbers we'll assign.
  const twilioIntegration = await prisma.integration.findFirst({
    where: { provider: "TWILIO", systemSetting: { userId: adminUserId } },
  });
  const twilioCreds = twilioIntegration?.credentials as any;
  if (!twilioCreds?.accountSid) {
    throw new Error("Admin has no Twilio subaccount — set up TWILIO integration first.");
  }
  const subAccountSid = twilioCreds.accountSid as string;
  const subClient = twilio(subAccountSid, twilioCreds.authToken);

  // 1. Find the admin's primary Business Profile on the subaccount.
  const profiles = await subClient.trusthub.v1.customerProfiles.list({ limit: 20 });
  const primary = profiles.find(p => p.status === "twilio-approved") ?? profiles[0];
  if (!primary) {
    throw new Error(
      "No primary Business Profile found for this admin — complete A2P/Business Profile onboarding first."
    );
  }
  const customerProfileSid = primary.sid;

  // Seed the integration row up-front so partial failures leave a resumable record.
  await prisma.integration.upsert({
    where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_VOICE_INTEGRITY" } },
    create: {
      systemSettingId,
      provider: "TWILIO_VOICE_INTEGRITY",
      status: "NEED_SETUP",
      credentials: { customerProfileSid, status: "draft" } as any,
    },
    update: {
      credentials: { customerProfileSid, status: "draft" } as any,
      errorMessage: null,
    },
  });

  try {
    // 2. Attach every owned number to the business profile (idempotent per-number).
    const owned = await subClient.incomingPhoneNumbers.list({ limit: 1000 });
    for (const n of owned) {
      try {
        await masterClient.trusthub.v1
          .customerProfiles(customerProfileSid)
          .customerProfilesChannelEndpointAssignment.create({
            channelEndpointType: "phone-number",
            channelEndpointSid: n.sid,
          });
      } catch (err: any) {
        // 409 / already-attached is fine.
        if (!/already/i.test(err.message || "")) {
          console.warn(`[VoiceIntegrity] attach profile skip ${n.phoneNumber}: ${err.message}`);
        }
      }
    }

    // 3. Create Voice Integrity Trust Product.
    const trustProduct = await masterClient.trusthub.v1.trustProducts.create({
      friendlyName: `Voice Integrity — ${adminUserId}`,
      email: primary.email || "support@slingvo.com",
      policySid: VOICE_INTEGRITY_POLICY_SID,
    });

    // 4. Create End User of type voice_integrity_information.
    const endUser = await masterClient.trusthub.v1.endUsers.create({
      friendlyName: `Voice Integrity End User — ${adminUserId}`,
      type: "voice_integrity_information",
      attributes: {
        use_case: attrs.useCase,
        business_employee_count: attrs.businessEmployeeCount,
        average_business_day_call_volume: attrs.averageBusinessDayCallVolume,
        notes: attrs.notes || "",
      },
    });

    // 5. Link end user → trust product.
    await masterClient.trusthub.v1
      .trustProducts(trustProduct.sid)
      .trustProductsEntityAssignments.create({ objectSid: endUser.sid });

    // 6. Link business profile → trust product.
    await masterClient.trusthub.v1
      .trustProducts(trustProduct.sid)
      .trustProductsEntityAssignments.create({ objectSid: customerProfileSid });

    // 7. Assign every phone number to the trust product, and remember the
    //    assignment SID on the local CallerId row so we can unassign on release.
    for (const n of owned) {
      try {
        const assignment = await masterClient.trusthub.v1
          .trustProducts(trustProduct.sid)
          .trustProductsChannelEndpointAssignment.create({
            channelEndpointType: "phone-number",
            channelEndpointSid: n.sid,
          });
        await prisma.callerId.updateMany({
          where: { twillioSid: n.sid, systemSetting: { userId: adminUserId } },
          data: { voiceIntegrityAssignmentSid: assignment.sid },
        });
      } catch (err: any) {
        console.warn(`[VoiceIntegrity] assign TP skip ${n.phoneNumber}: ${err.message}`);
      }
    }

    // 8. Submit for vetting.
    await masterClient.trusthub.v1
      .trustProducts(trustProduct.sid)
      .update({ status: "pending-review" });

    const credentials: VoiceIntegrityCredentials = {
      customerProfileSid,
      trustProductSid: trustProduct.sid,
      endUserSid: endUser.sid,
      status: "pending-review",
      rejectionReason: null,
    };

    await prisma.integration.update({
      where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_VOICE_INTEGRITY" } },
      data: { credentials: credentials as any, status: "NEED_SETUP", errorMessage: null },
    });

    return credentials;
  } catch (error: any) {
    console.error("[VoiceIntegrity] Onboarding failed:", error?.message);
    await prisma.integration.update({
      where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_VOICE_INTEGRITY" } },
      data: { errorMessage: error?.message?.slice(0, 500) },
    });
    throw error;
  }
}

/**
 * Poll Twilio for the trust product's current review status and mirror it
 * onto the integration row. On approval, flip every assigned CallerId's
 * voiceIntegrityRegistered flag to true.
 */
export async function refreshStatus(adminUserId: string): Promise<VoiceIntegrityCredentials> {
  const current = await getStatus(adminUserId);
  if (current.status === "not-started" || !current.trustProductSid) return current;

  const tp = await masterClient.trusthub.v1.trustProducts(current.trustProductSid).fetch();
  // Twilio's status strings match ours 1:1 (draft / pending-review / twilio-approved / twilio-rejected).
  const nextStatus = tp.status as VoiceIntegrityStatus;
  const next: VoiceIntegrityCredentials = {
    ...current,
    status: nextStatus,
    rejectionReason: (tp as any).errors ? JSON.stringify((tp as any).errors) : null,
  };

  const systemSettingId = await getSystemSettingId(adminUserId);
  await prisma.integration.update({
    where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_VOICE_INTEGRITY" } },
    data: {
      credentials: next as any,
      status: nextStatus === "twilio-approved" ? "CONNECTED" : "NEED_SETUP",
    },
  });

  if (nextStatus === "twilio-approved") {
    await prisma.callerId.updateMany({
      where: {
        systemSetting: { userId: adminUserId },
        voiceIntegrityAssignmentSid: { not: null },
      },
      data: { voiceIntegrityRegistered: true },
    });
  }

  return next;
}

/**
 * Called from the number-purchase flow after the number has been transferred
 * to the admin's subaccount. If the admin's Voice Integrity trust product
 * is approved, attach the new number to it. Silent no-op otherwise — the
 * next backfill pass will pick it up when approval lands.
 */
export async function assignNumber(adminUserId: string, twilioSid: string): Promise<void> {
  const status = await getStatus(adminUserId);
  if (!status.trustProductSid || !status.customerProfileSid) return;

  try {
    // Ensure it's on the business profile first (Trust Hub requires this).
    await masterClient.trusthub.v1
      .customerProfiles(status.customerProfileSid)
      .customerProfilesChannelEndpointAssignment.create({
        channelEndpointType: "phone-number",
        channelEndpointSid: twilioSid,
      })
      .catch(err => {
        if (!/already/i.test(err.message || "")) throw err;
      });

    const assignment = await masterClient.trusthub.v1
      .trustProducts(status.trustProductSid)
      .trustProductsChannelEndpointAssignment.create({
        channelEndpointType: "phone-number",
        channelEndpointSid: twilioSid,
      });

    await prisma.callerId.updateMany({
      where: { twillioSid: twilioSid, systemSetting: { userId: adminUserId } },
      data: {
        voiceIntegrityAssignmentSid: assignment.sid,
        voiceIntegrityRegistered: status.status === "twilio-approved",
      },
    });
  } catch (error: any) {
    // Never block number provisioning on Trust Hub errors — just log.
    console.error(`[VoiceIntegrity] assignNumber ${twilioSid} failed:`, error?.message);
  }
}

/**
 * Called from the number-release flow. Deletes the assignment SID on Twilio,
 * clears local flags. Silent no-op if there's no assignment recorded.
 */
export async function unassignNumber(adminUserId: string, twilioSid: string): Promise<void> {
  const cid = await prisma.callerId.findFirst({
    where: { twillioSid: twilioSid, systemSetting: { userId: adminUserId } },
    select: { voiceIntegrityAssignmentSid: true },
  });
  if (!cid?.voiceIntegrityAssignmentSid) return;

  const status = await getStatus(adminUserId);
  if (!status.trustProductSid) return;

  try {
    await masterClient.trusthub.v1
      .trustProducts(status.trustProductSid)
      .trustProductsChannelEndpointAssignment(cid.voiceIntegrityAssignmentSid)
      .remove();
  } catch (error: any) {
    console.warn(`[VoiceIntegrity] unassignNumber ${twilioSid}:`, error?.message);
  }

  await prisma.callerId.updateMany({
    where: { twillioSid: twilioSid, systemSetting: { userId: adminUserId } },
    data: { voiceIntegrityAssignmentSid: null, voiceIntegrityRegistered: false },
  });
}

/**
 * Backfill: attach every one of the admin's already-owned numbers to their
 * approved trust product. Invoked after a fresh approval (or manually from
 * the settings page) so numbers bought before approval get registered.
 */
export async function backfillAssignments(adminUserId: string): Promise<{ attached: number; skipped: number }> {
  const status = await getStatus(adminUserId);
  if (status.status !== "twilio-approved" || !status.trustProductSid) {
    return { attached: 0, skipped: 0 };
  }

  const numbers = await prisma.callerId.findMany({
    where: {
      systemSetting: { userId: adminUserId },
      twillioSid: { not: null },
      voiceIntegrityAssignmentSid: null,
    },
    select: { twillioSid: true },
  });

  let attached = 0;
  let skipped = 0;
  for (const n of numbers) {
    if (!n.twillioSid) continue;
    try {
      await assignNumber(adminUserId, n.twillioSid);
      attached++;
    } catch {
      skipped++;
    }
  }
  return { attached, skipped };
}
