import prisma from "../lib/prisma";
import { client as masterClient } from "../lib/config";
import twilio from "twilio";
import { getUserPlanLimits } from "./planLimits.service";

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
  | "twilio-rejected"
  // Admin has no TWILIO subaccount yet — the prerequisite for Voice Integrity.
  // We surface this as a distinct status so the frontend can skip the modal
  // for these admins instead of nagging them with a flow they can't complete.
  | "blocked-no-twilio"
  // Admin has a subaccount but no approved Business Profile yet — Voice
  // Integrity needs one to attach the trust product to. Frontend skips the
  // modal; the existing A2P flow drives the profile creation.
  | "blocked-no-business-profile"
  // Admin's plan doesn't include the advanced deliverability suite. Frontend
  // skips the modal entirely; the settings panel disables the "Set up" button.
  | "blocked-plan-not-eligible";

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

/**
 * Resolve which Twilio account context this admin belongs to.
 *
 * Normal admins have their own subaccount (Integration row with credentials).
 * Legacy / master-account admins (like the client's own account) have no
 * subaccount — their numbers live directly on the platform master. We detect
 * them heuristically: no TWILIO integration row + at least one CallerId
 * already provisioned. A brand-new admin with neither is treated as
 * unconfigured and gets blocked-no-twilio.
 *
 * Returns null when the admin can't do VI at all (no context to attach to).
 */
/**
 * Pull the latest `trustProductsEvaluations` record for a Trust Product
 * and collapse its failed fields into a readable rejection reason string.
 * Trust products don't expose failure detail on the plain fetch payload,
 * so this evaluation endpoint is the only source of truth.
 *
 * Returns null when the evaluation can't be fetched or has no failures —
 * caller should fall back to a generic "rejected by Twilio" message.
 */
export async function fetchTrustProductRejectionReason(
  client: any,
  trustProductSid: string
): Promise<string | null> {
  try {
    const evals = await client.trusthub.v1
      .trustProducts(trustProductSid)
      .trustProductsEvaluations.list({ limit: 3 });
    const latest =
      evals.find((e: any) => e.status === "noncompliant") ?? evals[0];
    if (!latest?.results) return null;

    const failures: string[] = latest.results
      .flatMap((r: any) => r.fields || [])
      .filter((f: any) => f.passed === false)
      .map((f: any) => {
        const label = (f.friendly_name || f.object_field || "").toString().trim();
        const reason = (f.failure_reason || "invalid").toString().trim();
        return label ? `${label}: ${reason}` : reason;
      });

    // Dedupe (Twilio sometimes lists the same field twice under different
    // requirement groups) and cap the length so the UI banner stays sane.
    const unique = Array.from(new Set(failures)).filter(Boolean);
    if (!unique.length) return null;
    const compact = unique.slice(0, 6).join(" | ");
    return unique.length > 6
      ? `${compact} | (+${unique.length - 6} more issues)`
      : compact;
  } catch (err: any) {
    console.warn(
      `[TrustHub] fetchTrustProductRejectionReason(${trustProductSid}) failed:`,
      err?.message
    );
    return null;
  }
}

export async function resolveTwilioContext(
  adminUserId: string
): Promise<{ client: any; onMaster: boolean } | null> {
  const twilioInt = await prisma.integration.findFirst({
    where: { provider: "TWILIO", systemSetting: { userId: adminUserId } },
    select: { credentials: true },
  });
  const creds = twilioInt?.credentials as any;
  if (creds?.accountSid) {
    return { client: twilio(creds.accountSid, creds.authToken), onMaster: false };
  }

  // No subaccount — check if this admin has numbers on the master account.
  const anyCallerId = await prisma.callerId.findFirst({
    where: { systemSetting: { userId: adminUserId }, twillioSid: { not: null } },
    select: { id: true },
  });
  if (anyCallerId) {
    return { client: masterClient, onMaster: true };
  }

  return null;
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
  // Gate 0 (cheapest first — no network I/O): plan flag. Non-eligible plans
  // don't get the VI modal at all. Matches CNAM's behavior.
  const limits = await getUserPlanLimits(adminUserId).catch(() => null);
  if (!limits?.advancedDeliverabilityEnabled) {
    return { status: "blocked-plan-not-eligible" };
  }

  // Gate 1: the admin needs a Twilio context — either their own subaccount
  // or (for legacy master-account admins) at least one number provisioned
  // on master. Otherwise there's nothing for VI to attach to.
  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) {
    return { status: "blocked-no-twilio" };
  }

  // Gate 2: an approved Business Profile is required.
  //   - Subaccount admins: use their local a2p_registrations.customerProfileSid.
  //   - Master-account admins: query the master account for an approved profile
  //     directly (A2P was completed outside our per-admin flow — it lives on
  //     the master account, e.g. the client's own "Lumina Bridge" profile).
  if (ctx.onMaster) {
    const approvedProfile = await hasApprovedProfileOnClient(ctx.client);
    if (!approvedProfile) {
      return { status: "blocked-no-business-profile" };
    }
  } else {
    // Subaccount admins: Voice Integrity needs only the Customer Profile
    // itself twilio-approved, NOT the full A2P flow. Brand + Campaign are
    // SMS-only and often get rejected by TCR for legitimate use cases
    // (real estate, lead-gen). Blocking VI on those would strand admins
    // who are perfectly eligible to run branded voice.
    const a2p = await prisma.a2P_Registration.findUnique({
      where: { userId: adminUserId },
      select: { customerProfileApproved: true, customerProfileSid: true },
    });
    if (!a2p?.customerProfileApproved || !a2p?.customerProfileSid) {
      return { status: "blocked-no-business-profile" };
    }
  }

  const integration = await getIntegration(adminUserId);
  if (!integration || !integration.credentials) {
    return { status: "not-started" };
  }
  return integration.credentials as unknown as VoiceIntegrityCredentials;
}

/**
 * Best-effort check: does this client's account have any twilio-approved
 * Customer Profile? Used to gate master-account admins who did A2P outside
 * of our multi-tenant flow.
 */
async function hasApprovedProfileOnClient(client: any): Promise<boolean> {
  try {
    const profiles = await client.trusthub.v1.customerProfiles.list({ limit: 20 });
    return profiles.some((p: any) => p.status === "twilio-approved");
  } catch (err: any) {
    console.warn("[VoiceIntegrity] hasApprovedProfileOnClient failed:", err?.message);
    return false;
  }
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

  // Resolve the correct Twilio context for this admin:
  //   - subaccount client  → normal ISV admins (their own tenancy)
  //   - master client      → legacy master-account admins whose numbers live
  //                          directly on the client's master account (e.g. jason)
  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) {
    throw new Error("Admin has no Twilio context — set up TWILIO integration or provision numbers first.");
  }

  // 1. Find the primary Business Profile in the correct account context. For
  //    master-account admins this is the client's own approved profile
  //    (e.g. "Lumina Bridge"); for subaccount admins it's the one their A2P
  //    onboarding produced.
  const profiles = await ctx.client.trusthub.v1.customerProfiles.list({ limit: 20 });
  const primary =
    profiles.find((p: any) => p.status === "twilio-approved") ?? profiles[0];
  if (!primary) {
    throw new Error(
      "No primary Business Profile found — complete A2P/Business Profile onboarding first."
    );
  }
  const customerProfileSid = primary.sid;

  // Numbers to enrol: for subaccount admins we can list from Twilio directly
  // (the subaccount only owns their numbers). For master-account admins,
  // Twilio's list would include numbers belonging to OTHER master-account
  // admins too — so we scope to this admin's locally-tracked CallerIds.
  const ownedSids: string[] = ctx.onMaster
    ? (await prisma.callerId.findMany({
        where: {
          systemSetting: { userId: adminUserId },
          twillioSid: { not: null },
        },
        select: { twillioSid: true },
      })).map(c => c.twillioSid!).filter(Boolean)
    : (await ctx.client.incomingPhoneNumbers.list({ limit: 1000 })).map((n: any) => n.sid);

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

  // All Trust Hub writes go against the SAME account that owns the Business
  // Profile — subaccount for ISV admins, master for master-account admins.
  const hubClient = ctx.client;

  try {
    // 2. Attach every owned number to the business profile (idempotent per-number).
    for (const sid of ownedSids) {
      try {
        await hubClient.trusthub.v1
          .customerProfiles(customerProfileSid)
          .customerProfilesChannelEndpointAssignment.create({
            channelEndpointType: "phone-number",
            channelEndpointSid: sid,
          });
      } catch (err: any) {
        // 409 / already-attached is fine.
        if (!/already/i.test(err.message || "")) {
          console.warn(`[VoiceIntegrity] attach profile skip ${sid}: ${err.message}`);
        }
      }
    }

    // 3. Create Voice Integrity Trust Product.
    const trustProduct = await hubClient.trusthub.v1.trustProducts.create({
      friendlyName: `Voice Integrity — ${adminUserId}`,
      email: primary.email || "support@slingvo.com",
      policySid: VOICE_INTEGRITY_POLICY_SID,
    });

    // 4. Create End User of type voice_integrity_information.
    const endUser = await hubClient.trusthub.v1.endUsers.create({
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
    await hubClient.trusthub.v1
      .trustProducts(trustProduct.sid)
      .trustProductsEntityAssignments.create({ objectSid: endUser.sid });

    // 6. Link business profile → trust product.
    await hubClient.trusthub.v1
      .trustProducts(trustProduct.sid)
      .trustProductsEntityAssignments.create({ objectSid: customerProfileSid });

    // 7. Assign every phone number to the trust product, and remember the
    //    assignment SID on the local CallerId row so we can unassign on release.
    for (const sid of ownedSids) {
      try {
        const assignment = await hubClient.trusthub.v1
          .trustProducts(trustProduct.sid)
          .trustProductsChannelEndpointAssignment.create({
            channelEndpointType: "phone-number",
            channelEndpointSid: sid,
          });
        await prisma.callerId.updateMany({
          where: { twillioSid: sid, systemSetting: { userId: adminUserId } },
          data: { voiceIntegrityAssignmentSid: assignment.sid },
        });
      } catch (err: any) {
        console.warn(`[VoiceIntegrity] assign TP skip ${sid}: ${err.message}`);
      }
    }

    // 8. Submit for vetting.
    await hubClient.trusthub.v1
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

  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return current;
  const tp = await ctx.client.trusthub.v1.trustProducts(current.trustProductSid).fetch();
  // Twilio's status strings match ours 1:1 (draft / pending-review / twilio-approved / twilio-rejected).
  const nextStatus = tp.status as VoiceIntegrityStatus;
  // Trust products don't carry rejection detail on the fetch payload —
  // `(tp as any).errors` was always undefined, so the UI was showing "null".
  // The real reasons live in the trust product's evaluation records, same
  // shape as customer profile evaluations. Pull the latest noncompliant
  // one and summarize its failed fields into a readable string.
  const rejectionReason =
    nextStatus === "twilio-rejected"
      ? await fetchTrustProductRejectionReason(ctx.client, current.trustProductSid)
      : null;
  const next: VoiceIntegrityCredentials = {
    ...current,
    status: nextStatus,
    rejectionReason,
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

  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return;
  const hubClient = ctx.client;

  try {
    // Ensure it's on the business profile first (Trust Hub requires this).
    await hubClient.trusthub.v1
      .customerProfiles(status.customerProfileSid)
      .customerProfilesChannelEndpointAssignment.create({
        channelEndpointType: "phone-number",
        channelEndpointSid: twilioSid,
      })
      .catch((err: any) => {
        if (!/already/i.test(err.message || "")) throw err;
      });

    const assignment = await hubClient.trusthub.v1
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

  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return;

  try {
    await ctx.client.trusthub.v1
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
