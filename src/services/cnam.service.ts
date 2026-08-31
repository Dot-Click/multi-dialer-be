import prisma from "../lib/prisma";
import {
  resolveTwilioContext,
  fetchTrustProductRejectionReason,
  getStatus as getVoiceIntegrityStatus,
} from "./voiceIntegrity.service";
import { getUserPlanLimits } from "./planLimits.service";

/**
 * Twilio CNAM (branded caller name) — Trust Hub enrolment for displaying
 * a branded business name on outbound calls (e.g. "Slingvo Realty" instead
 * of just "+1 (334) 555-0100").
 *
 * Ordering: CNAM builds on top of Voice Integrity, which builds on top of
 * A2P's Business Profile. All three cascade off the same customer profile
 * and reuse the same subaccount / master-account context resolution.
 *
 * Storage model: one Integration row per admin (provider = TWILIO_CNAM),
 * credentials JSON carries the Trust Hub SIDs, the display name, and the
 * status. No new tables.
 *
 *   {
 *     customerProfileSid: "BU...",
 *     trustProductSid:    "BU...",
 *     endUserSid:         "IT...",
 *     displayName:        "Slingvo Realty",
 *     status:             "draft" | "pending-review" | "twilio-approved" | "twilio-rejected",
 *     rejectionReason:    string | null,
 *   }
 *
 * CNAM policy SID is fixed by Twilio and matches the one the client already
 * uses on master for their own account ("Lumina Bridge").
 */
const CNAM_POLICY_SID = "RNb0d4771c2c98518d916a3d4cd70a8f8b";
const CNAM_DISPLAY_NAME_MAX = 15;

export type CnamStatus =
  | "not-started"
  | "draft"
  | "pending-review"
  | "twilio-approved"
  | "twilio-rejected"
  // Gate 1: admin has no Twilio subaccount and no numbers on master.
  | "blocked-no-twilio"
  // Gate 2: admin's Business Profile isn't approved yet.
  | "blocked-no-business-profile"
  // Gate 3 (CNAM-specific): Voice Integrity must be approved first.
  //   Design decision: CNAM is offered only after VI is approved so the
  //   trust chain is complete before the branded name is pushed to carriers.
  | "blocked-no-voice-integrity"
  // Gate 4: admin's plan doesn't include the advanced deliverability suite.
  | "blocked-plan-not-eligible";

export interface CnamCredentials {
  customerProfileSid?: string;
  trustProductSid?: string;
  endUserSid?: string;
  displayName?: string;
  status: CnamStatus;
  rejectionReason?: string | null;
}

export interface CnamAttributes {
  displayName: string; // ≤ 15 chars — the branded caller name that shows on recipient phones.
  useCase?: string;
  notes?: string;
}

async function getIntegration(adminUserId: string) {
  return prisma.integration.findFirst({
    where: {
      provider: "TWILIO_CNAM",
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
 * Read current status. Never throws — returns a blocked-* status for admins
 * who can't proceed, "not-started" for admins who can but haven't started.
 */
export async function getStatus(adminUserId: string): Promise<CnamCredentials> {
  // Gate 4 (cheapest first — no network I/O): plan flag. Non-eligible plans
  // don't get the CNAM modal at all.
  const limits = await getUserPlanLimits(adminUserId).catch(() => null);
  if (!limits?.advancedDeliverabilityEnabled) {
    return { status: "blocked-plan-not-eligible" };
  }

  // Gate 1: Twilio context (subaccount or master fallback).
  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return { status: "blocked-no-twilio" };

  // Gate 2 & 3: reuse VI's own gating logic. VI's status already tells us
  // whether A2P is done and whether VI itself is approved.
  const vi = await getVoiceIntegrityStatus(adminUserId);
  if (vi.status === "blocked-no-twilio") return { status: "blocked-no-twilio" };
  if (vi.status === "blocked-no-business-profile") return { status: "blocked-no-business-profile" };
  if (vi.status !== "twilio-approved") return { status: "blocked-no-voice-integrity" };

  const integration = await getIntegration(adminUserId);
  if (!integration || !integration.credentials) return { status: "not-started" };
  return integration.credentials as unknown as CnamCredentials;
}

/**
 * Execute the CNAM Trust Hub sequence — same shape as Voice Integrity's,
 * with the CNAM policy SID and cnam_information end-user type.
 *
 * Prerequisite: VI must already be approved (getStatus returns the appropriate
 * blocked-* status otherwise). Submit is idempotent-ish: partial failures
 * leave a resumable draft record in the integration row.
 */
export async function submitOnboarding(
  adminUserId: string,
  attrs: CnamAttributes
): Promise<CnamCredentials> {
  const displayName = (attrs.displayName || "").trim();
  if (!displayName) throw new Error("Display name is required.");
  if (displayName.length > CNAM_DISPLAY_NAME_MAX) {
    throw new Error(`Display name must be ${CNAM_DISPLAY_NAME_MAX} characters or fewer.`);
  }

  const gate = await getStatus(adminUserId);
  if (gate.status.startsWith("blocked-")) {
    throw new Error(`Cannot start CNAM onboarding: ${gate.status}`);
  }

  const systemSettingId = await getSystemSettingId(adminUserId);
  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) throw new Error("No Twilio context resolved for CNAM onboarding.");

  // 1. Find the approved Business Profile in the correct account context.
  const profiles = await ctx.client.trusthub.v1.customerProfiles.list({ limit: 20 });
  const primary = profiles.find((p: any) => p.status === "twilio-approved") ?? profiles[0];
  if (!primary) throw new Error("No primary Business Profile found for CNAM.");
  const customerProfileSid = primary.sid;

  // Numbers to enrol — scope to THIS admin's caller_ids only.
  const ownedSids: string[] = ctx.onMaster
    ? (
        await prisma.callerId.findMany({
          where: { systemSetting: { userId: adminUserId }, twillioSid: { not: null } },
          select: { twillioSid: true },
        })
      ).map(c => c.twillioSid!).filter(Boolean)
    : (await ctx.client.incomingPhoneNumbers.list({ limit: 1000 })).map((n: any) => n.sid);

  // Seed the integration row so partial failures are resumable.
  await prisma.integration.upsert({
    where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_CNAM" } },
    create: {
      systemSettingId,
      provider: "TWILIO_CNAM",
      status: "NEED_SETUP",
      credentials: { customerProfileSid, displayName, status: "draft" } as any,
    },
    update: {
      credentials: { customerProfileSid, displayName, status: "draft" } as any,
      errorMessage: null,
    },
  });

  const hubClient = ctx.client;
  try {
    // 2. Numbers should already be on the business profile from VI onboarding,
    //    but re-attach idempotently in case anything's out of sync.
    for (const sid of ownedSids) {
      try {
        await hubClient.trusthub.v1
          .customerProfiles(customerProfileSid)
          .customerProfilesChannelEndpointAssignment.create({
            channelEndpointType: "phone-number",
            channelEndpointSid: sid,
          });
      } catch (err: any) {
        if (!/already/i.test(err.message || "")) {
          console.warn(`[CNAM] attach profile skip ${sid}: ${err.message}`);
        }
      }
    }

    // 3. Create CNAM Trust Product.
    const trustProduct = await hubClient.trusthub.v1.trustProducts.create({
      friendlyName: `CNAM — ${displayName}`,
      email: primary.email || "support@slingvo.com",
      policySid: CNAM_POLICY_SID,
    });

    // 4. Create End User of type cnam_information carrying the display name.
    const endUser = await hubClient.trusthub.v1.endUsers.create({
      friendlyName: `CNAM End User — ${adminUserId}`,
      type: "cnam_information",
      attributes: {
        display_name: displayName,
        use_case: attrs.useCase || "sales_dialer",
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

    // 7. Assign every phone number to the trust product; save assignment SIDs
    //    on caller_id so unassign works cleanly on number release.
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
          data: { cnamAssignmentSid: assignment.sid },
        });
      } catch (err: any) {
        console.warn(`[CNAM] assign TP skip ${sid}: ${err.message}`);
      }
    }

    // 8. Submit for vetting.
    await hubClient.trusthub.v1
      .trustProducts(trustProduct.sid)
      .update({ status: "pending-review" });

    const credentials: CnamCredentials = {
      customerProfileSid,
      trustProductSid: trustProduct.sid,
      endUserSid: endUser.sid,
      displayName,
      status: "pending-review",
      rejectionReason: null,
    };

    await prisma.integration.update({
      where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_CNAM" } },
      data: { credentials: credentials as any, status: "NEED_SETUP", errorMessage: null },
    });

    return credentials;
  } catch (error: any) {
    console.error("[CNAM] Onboarding failed:", error?.message);
    await prisma.integration.update({
      where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_CNAM" } },
      data: { errorMessage: error?.message?.slice(0, 500) },
    });
    throw error;
  }
}

/**
 * Poll Twilio for CNAM trust product status; mirror onto the integration
 * row. On approval, flip cnamRegistered on every assigned caller_id.
 */
export async function refreshStatus(adminUserId: string): Promise<CnamCredentials> {
  const current = await getStatus(adminUserId);
  if (current.status.startsWith("blocked-") || current.status === "not-started" || !current.trustProductSid) {
    return current;
  }

  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return current;

  const tp = await ctx.client.trusthub.v1.trustProducts(current.trustProductSid).fetch();
  const nextStatus = tp.status as CnamStatus;
  // Same fix as Voice Integrity — `(tp as any).errors` isn't a thing on
  // the fetch payload, so we were writing "null" as the rejection reason.
  // Pull the evaluation record and summarize its failed fields.
  const rejectionReason =
    nextStatus === "twilio-rejected"
      ? await fetchTrustProductRejectionReason(ctx.client, current.trustProductSid)
      : null;
  const next: CnamCredentials = {
    ...current,
    status: nextStatus,
    rejectionReason,
  };

  const systemSettingId = await getSystemSettingId(adminUserId);
  await prisma.integration.update({
    where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_CNAM" } },
    data: {
      credentials: next as any,
      status: nextStatus === "twilio-approved" ? "CONNECTED" : "NEED_SETUP",
    },
  });

  if (nextStatus === "twilio-approved") {
    await prisma.callerId.updateMany({
      where: {
        systemSetting: { userId: adminUserId },
        cnamAssignmentSid: { not: null },
      },
      data: { cnamRegistered: true },
    });
  }

  return next;
}

/**
 * Called on number purchase. Attaches the new number to the admin's CNAM
 * trust product if approved. Silent no-op if CNAM isn't ready yet — the
 * backfill job picks it up when it is.
 */
export async function assignNumber(adminUserId: string, twilioSid: string): Promise<void> {
  const status = await getStatus(adminUserId);
  if (!status.trustProductSid || !status.customerProfileSid) return;

  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return;
  const hubClient = ctx.client;

  try {
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
        cnamAssignmentSid: assignment.sid,
        cnamRegistered: status.status === "twilio-approved",
      },
    });
  } catch (error: any) {
    console.error(`[CNAM] assignNumber ${twilioSid} failed:`, error?.message);
  }
}

/**
 * Called on number release. Removes the CNAM assignment on Twilio, clears
 * local flags. Silent no-op if not assigned.
 */
export async function unassignNumber(adminUserId: string, twilioSid: string): Promise<void> {
  const cid = await prisma.callerId.findFirst({
    where: { twillioSid: twilioSid, systemSetting: { userId: adminUserId } },
    select: { cnamAssignmentSid: true },
  });
  if (!cid?.cnamAssignmentSid) return;

  const status = await getStatus(adminUserId);
  if (!status.trustProductSid) return;
  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return;

  try {
    await ctx.client.trusthub.v1
      .trustProducts(status.trustProductSid)
      .trustProductsChannelEndpointAssignment(cid.cnamAssignmentSid)
      .remove();
  } catch (error: any) {
    console.warn(`[CNAM] unassignNumber ${twilioSid}:`, error?.message);
  }

  await prisma.callerId.updateMany({
    where: { twillioSid: twilioSid, systemSetting: { userId: adminUserId } },
    data: { cnamAssignmentSid: null, cnamRegistered: false },
  });
}

/**
 * Backfill: attach every one of the admin's already-owned numbers to their
 * approved CNAM trust product. Invoked after approval or manually from
 * settings.
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
      cnamAssignmentSid: null,
    },
    select: { twillioSid: true },
  });

  let attached = 0, skipped = 0;
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
