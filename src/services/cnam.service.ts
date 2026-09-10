import axios from "axios";
import prisma from "../lib/prisma";
import {
  resolveTwilioContext,
  getStatus as getVoiceIntegrityStatus,
} from "./voiceIntegrity.service";
import { getUserPlanLimits } from "./planLimits.service";

/**
 * Twilio CNAM (branded caller name) — Compliance Registrations (v4) enrolment
 * for displaying a branded business name on outbound calls (e.g. "Slingvo
 * Realty" instead of just "+1 (334) 555-0100").
 *
 * IMPORTANT — this targets Twilio's v4 Branded Calling API, which is in
 * PRIVATE BETA as of writing. The account (or ISV master) must first be
 * granted access via Twilio's request form:
 *   https://airtable.com/appU2UfGNjztpFOeu/pagdvnRAJdjGjkPEO/form
 * Until access is granted, every call below will keep failing with Twilio's
 * "This endpoint is not supported on v2..." rejection regardless of payload
 * shape — that is an account-entitlement error, not a code bug.
 *
 * This replaces the old Trust Hub `trustProducts` / `endUsers` flow (type
 * `branded_calls_information`), which Twilio has deprecated for CNAM. The v4
 * resources live at a different host/path and are NOT exposed via the
 * `twilio` npm SDK's typed helpers yet, so this service talks to them with
 * plain HTTP (axios + Basic Auth) instead of `client.trusthub.v1...`.
 *
 * v4 "US Basic" registration shape (the policy this product already used,
 * RNca63d1066fbd5e44eac02d0b3cf6d019, is also the v4 US Basic regulation id):
 *
 *   POST /v4/Compliance/Registrations
 *   {
 *     regulationId: "RNca63d1066fbd5e44eac02d0b3cf6d019",
 *     regulationVersion: <int>,        // from GET /v4/Compliance/Regulations/{id}
 *     friendlyName, statusNotificationEmail, statusCallbackUrl?,
 *     data: {
 *       brandedCaller: {
 *         displayName,                  // 1-15 chars, must start with a letter
 *         displayLongName,              // 1-32 chars
 *         voiceIntegrityRegistrationId, // "BU..." — see ASSUMPTION below
 *       }
 *     }
 *   }
 *
 * ASSUMPTION (unverified against a live beta account): `voiceIntegrityRegistrationId`
 * is populated with the admin's already-approved Voice Integrity trust
 * product SID (still on the older Trust Hub API — VI itself has not been
 * migrated). Both old Trust Product SIDs and new v4 registration ids share
 * the "BU" + 32 hex chars format, so this is plausible but NOT confirmed by
 * Twilio's docs. If Twilio rejects with an "invalid voiceIntegrityRegistrationId"
 * error once beta access is live, Voice Integrity will likely need its own v4
 * migration first.
 *
 * Storage model: unchanged — one Integration row per admin (provider =
 * TWILIO_CNAM), credentials JSON now carries the Compliance Registration id
 * instead of trustProductSid/endUserSid. No new tables. `caller_id.cnamAssignmentSid`
 * now stores the ResourceAssignment sid ("RA...") instead of the old
 * trustProductsChannelEndpointAssignment sid.
 */
const CNAM_REGULATION_ID = "RNca63d1066fbd5e44eac02d0b3cf6d019";
const CNAM_DISPLAY_NAME_MAX = 15;
const CNAM_LONG_DISPLAY_NAME_MAX = 32;
// Twilio's documented pattern for brandedCaller.displayName: must start with
// a letter, then letters/digits/comma/period/whitespace.
const CNAM_DISPLAY_NAME_PATTERN = /^[a-zA-Z][A-Za-z0-9,.\s]{1,14}$/;

const COMPLIANCE_BASE_URL = "https://trusthub.twilio.com/v4/Compliance";
const RESOURCE_ASSIGNMENTS_BASE_URL = "https://trusthub.twilio.com/v1/Compliance";

async function complianceGet(accountSid: string, authToken: string, path: string): Promise<any> {
  const res = await axios.get(`${COMPLIANCE_BASE_URL}${path}`, {
    auth: { username: accountSid, password: authToken },
  });
  return res.data;
}

async function compliancePost(accountSid: string, authToken: string, path: string, body: Record<string, any>): Promise<any> {
  const res = await axios.post(`${COMPLIANCE_BASE_URL}${path}`, body, {
    auth: { username: accountSid, password: authToken },
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
}

async function compliancePatch(accountSid: string, authToken: string, path: string, body: Record<string, any>) {
  const res = await axios.patch(`${COMPLIANCE_BASE_URL}${path}`, body, {
    auth: { username: accountSid, password: authToken },
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
}

async function resourceAssignmentCreate(
  accountSid: string,
  authToken: string,
  registrationId: string,
  resourceSid: string
) {
  const form = new URLSearchParams();
  form.set("Type", "phone-number");
  form.set("ResourceSid", resourceSid);
  const res = await axios.post(
    `${RESOURCE_ASSIGNMENTS_BASE_URL}/Registrations/${registrationId}/ResourceAssignments`,
    form,
    {
      auth: { username: accountSid, password: authToken },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );
  return res.data as { sid: string };
}

async function resourceAssignmentRemove(
  accountSid: string,
  authToken: string,
  registrationId: string,
  assignmentSid: string
) {
  await axios.delete(
    `${RESOURCE_ASSIGNMENTS_BASE_URL}/Registrations/${registrationId}/ResourceAssignments/${assignmentSid}`,
    { auth: { username: accountSid, password: authToken } }
  );
}

// Twilio's v4 status enum is upper-snake; the rest of this app (routes,
// frontend slice, other trust-hub flows) already speaks the old Trust Hub's
// lower-hyphen style. Normalize at the boundary so nothing else has to change.
type V4RegistrationStatus = "DRAFT" | "PENDING_REVIEW" | "IN_REVIEW" | "TWILIO_APPROVED" | "TWILIO_REJECTED";

function normalizeV4Status(status: string): CnamStatus {
  switch (status as V4RegistrationStatus) {
    case "DRAFT": return "draft";
    case "PENDING_REVIEW":
    case "IN_REVIEW": return "pending-review";
    case "TWILIO_APPROVED": return "twilio-approved";
    case "TWILIO_REJECTED": return "twilio-rejected";
    default: return "draft";
  }
}

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
  registrationId?: string;
  displayName?: string;
  status: CnamStatus;
  rejectionReason?: string | null;
}

export interface CnamAttributes {
  // Short branded caller name shown on the recipient's phone. Twilio's v4
  // US Basic schema: 1-15 chars, must start with a letter, then
  // letters/digits/comma/period/whitespace only.
  displayName: string;
  // Longer business name shown in richer UIs (iOS with First Orion, etc.).
  // Twilio's v4 US Basic schema: 1-32 chars.
  longDisplayName: string;
  // Required. Twilio emails this address when review completes.
  notificationEmail: string;
  // Optional webhook for real-time status transitions.
  statusCallbackUrl?: string;
  // Carrier-terms certification — required before submission. UI-only; not
  // sent to Twilio (the v4 US Basic schema has no consent field), but we
  // still require it locally since it's the same certification the old flow
  // made admins agree to.
  consent: boolean;
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
 * Execute the v4 Compliance Registration sequence for a "US Basic" branded
 * caller registration.
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
  if (!CNAM_DISPLAY_NAME_PATTERN.test(displayName)) {
    throw new Error("Display name must start with a letter and contain only letters, numbers, commas, periods, and spaces.");
  }
  const longDisplayName = (attrs.longDisplayName || "").trim();
  if (!longDisplayName) throw new Error("Long display name is required.");
  if (longDisplayName.length > CNAM_LONG_DISPLAY_NAME_MAX) {
    throw new Error(`Long display name must be ${CNAM_LONG_DISPLAY_NAME_MAX} characters or fewer.`);
  }
  const notificationEmail = (attrs.notificationEmail || "").trim();
  if (!notificationEmail) throw new Error("Notification email is required.");
  if (!/^\S+@\S+\.\S+$/.test(notificationEmail)) {
    throw new Error("Notification email is invalid.");
  }
  if (!attrs.consent) {
    throw new Error("You must certify that the business is the caller of record to enable Branded Calling.");
  }

  const gate = await getStatus(adminUserId);
  if (gate.status.startsWith("blocked-")) {
    throw new Error(`Cannot start CNAM onboarding: ${gate.status}`);
  }

  const systemSettingId = await getSystemSettingId(adminUserId);
  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) throw new Error("No Twilio context resolved for CNAM onboarding.");
  const { accountSid, authToken } = ctx;

  // Voice Integrity trust product SID, reused as voiceIntegrityRegistrationId.
  // See the ASSUMPTION note at the top of this file.
  const viIntegration = await prisma.integration.findFirst({
    where: { provider: "TWILIO_VOICE_INTEGRITY", systemSetting: { userId: adminUserId } },
    select: { credentials: true },
  });
  const viTrustProductSid = (viIntegration?.credentials as any)?.trustProductSid;
  if (!viTrustProductSid) {
    throw new Error("Voice Integrity trust product SID not found — Branded Calling requires an approved VI bundle to reference.");
  }

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
      credentials: { displayName, status: "draft" } as any,
    },
    update: {
      credentials: { displayName, status: "draft" } as any,
      errorMessage: null,
    },
  });

  try {
    // 1. Look up the regulation to get its current version — required on
    //    Registration create. Field name unconfirmed against a live
    //    response; falls back defensively.
    const regulation = await complianceGet(accountSid, authToken, `/Regulations/${CNAM_REGULATION_ID}`);
    const regulationVersion = regulation?.version ?? regulation?.regulationVersion ?? 1;

    // 2. Create the Compliance Registration (US Basic — display name(s) +
    //    link to the approved Voice Integrity registration).
    const registration = await compliancePost(accountSid, authToken, "/Registrations", {
      regulationId: CNAM_REGULATION_ID,
      regulationVersion,
      friendlyName: `CNAM — ${displayName}`,
      statusNotificationEmail: notificationEmail,
      ...(attrs.statusCallbackUrl?.trim() ? { statusCallbackUrl: attrs.statusCallbackUrl.trim() } : {}),
      data: {
        brandedCaller: {
          displayName,
          displayLongName: longDisplayName,
          voiceIntegrityRegistrationId: viTrustProductSid,
        },
      },
    });
    const registrationId = registration.id as string;

    // 3. Assign every phone number to the registration; save assignment SIDs
    //    on caller_id so unassign works cleanly on number release.
    for (const sid of ownedSids) {
      try {
        const assignment = await resourceAssignmentCreate(accountSid, authToken, registrationId, sid);
        await prisma.callerId.updateMany({
          where: { twillioSid: sid, systemSetting: { userId: adminUserId } },
          data: { cnamAssignmentSid: assignment.sid },
        });
      } catch (err: any) {
        console.warn(`[CNAM] assign resource skip ${sid}: ${err?.response?.data?.message || err.message}`);
      }
    }

    // 4. Submit for vetting.
    await compliancePatch(accountSid, authToken, `/Registrations/${registrationId}`, {
      status: "PENDING_REVIEW",
    });

    const credentials: CnamCredentials = {
      registrationId,
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
    const message = error?.response?.data?.message || error?.message;
    console.error("[CNAM] Onboarding failed:", message);
    await prisma.integration.update({
      where: { systemSettingId_provider: { systemSettingId, provider: "TWILIO_CNAM" } },
      data: { errorMessage: (message || "").slice(0, 500) },
    });
    throw new Error(message || "CNAM onboarding failed.");
  }
}

/**
 * Poll Twilio for the Compliance Registration's status; mirror onto the
 * integration row. On approval, flip cnamRegistered on every assigned
 * caller_id.
 */
export async function refreshStatus(adminUserId: string): Promise<CnamCredentials> {
  const current = await getStatus(adminUserId);
  if (current.status.startsWith("blocked-") || current.status === "not-started" || !current.registrationId) {
    return current;
  }

  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return current;
  const { accountSid, authToken } = ctx;

  let registration: any;
  try {
    registration = await complianceGet(accountSid, authToken, `/Registrations/${current.registrationId}`);
  } catch (err: any) {
    console.warn(`[CNAM] refreshStatus fetch failed for ${adminUserId}:`, err?.response?.data?.message || err.message);
    return current;
  }

  const nextStatus = normalizeV4Status(registration.status);
  // v4 surfaces failures on `dataErrors` rather than the old Trust Hub
  // evaluations endpoint. Shape unconfirmed against a live rejection —
  // fall back to a generic message if it's not an array of strings/objects.
  const rejectionReason =
    nextStatus === "twilio-rejected"
      ? Array.isArray(registration.dataErrors) && registration.dataErrors.length
        ? registration.dataErrors
            .map((e: any) => (typeof e === "string" ? e : e?.message || JSON.stringify(e)))
            .slice(0, 6)
            .join(" | ")
        : "Twilio rejected this CNAM registration."
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
 * registration if one exists. Silent no-op if CNAM isn't ready yet — the
 * backfill job picks it up when it is.
 */
export async function assignNumber(adminUserId: string, twilioSid: string): Promise<void> {
  const status = await getStatus(adminUserId);
  if (!status.registrationId) return;

  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return;

  try {
    const assignment = await resourceAssignmentCreate(ctx.accountSid, ctx.authToken, status.registrationId, twilioSid);
    await prisma.callerId.updateMany({
      where: { twillioSid: twilioSid, systemSetting: { userId: adminUserId } },
      data: {
        cnamAssignmentSid: assignment.sid,
        cnamRegistered: status.status === "twilio-approved",
      },
    });
  } catch (error: any) {
    console.error(`[CNAM] assignNumber ${twilioSid} failed:`, error?.response?.data?.message || error?.message);
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
  if (!status.registrationId) return;
  const ctx = await resolveTwilioContext(adminUserId);
  if (!ctx) return;

  try {
    await resourceAssignmentRemove(ctx.accountSid, ctx.authToken, status.registrationId, cid.cnamAssignmentSid);
  } catch (error: any) {
    console.warn(`[CNAM] unassignNumber ${twilioSid}:`, error?.response?.data?.message || error?.message);
  }

  await prisma.callerId.updateMany({
    where: { twillioSid: twilioSid, systemSetting: { userId: adminUserId } },
    data: { cnamAssignmentSid: null, cnamRegistered: false },
  });
}

/**
 * Backfill: attach every one of the admin's already-owned numbers to their
 * approved CNAM registration. Invoked after approval or manually from
 * settings.
 */
export async function backfillAssignments(adminUserId: string): Promise<{ attached: number; skipped: number }> {
  const status = await getStatus(adminUserId);
  if (status.status !== "twilio-approved" || !status.registrationId) {
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
