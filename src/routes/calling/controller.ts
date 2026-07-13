import { errorResponse, successResponse } from "@/utils/handler";
import { client } from "@/lib/config";
import { client as masterClient } from "@/lib/config";
import { Request, Response, RequestHandler } from "express";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { dialerService } from "./services";
import prisma from "@/lib/prisma";
import { envConfig } from "@/lib/config";
import twilio from "twilio";
import { insertCallerIdInDb, resolveAdminId } from "../systemSettings/callerId/service";
import { getTwilioClient, getUserTwilioSubAccountSid, transferNumberToSubAccount, releaseNumber } from "../../services/twilio-account.service";
import { resolveBillableCustomer, addNumberToAddonSubscription, removeAddonSubscriptionItem, getMonthlyPriceCentsForCountry } from "../../services/phoneNumberBilling.service";
import { getUserPlanLimits } from "../../services/planLimits.service";
import { chunkArray } from "@/utils/helpers";

const { jwt: { AccessToken } } = twilio;
const VoiceGrant = AccessToken.VoiceGrant;

const fromNumber = envConfig.TWILIO_PHONE_NUMBER as string;
export const startCalling: RequestHandler = async (req, res) => {
  const agentId = req.params.agentId;
  try {
    const { to, contactId, from } = req.body;
    if (!to) {
      errorResponse(res, { message: "Phone number is required" }, 400);
      return;
    }

    // Hard guard: a number marked Bad Number (isValid=false), DNC (isDnc=true),
    // belonging to a DNC contact, or globally suppressed must NOT be dialable
    // from any path. The power dialer enforces this in makeCall(); the manual
    // click-to-call path must enforce it here too.
    const guardLast10 = to.replace(/\D/g, "").slice(-10);
    if (guardLast10.length >= 7) {
      const guardedPhone = await (prisma.contactPhone as any).findFirst({
        where: {
          number: { contains: guardLast10 },
          ...(contactId ? { contactId } : {}),
        },
        select: { isValid: true, isDnc: true, contact: { select: { status: true } } },
      });
      if (guardedPhone?.isValid === false) {
        errorResponse(res, { message: "This number is marked Bad Number and cannot be dialed." }, 409);
        return;
      }
      if (guardedPhone?.isDnc === true || guardedPhone?.contact?.status === "DO_NOT_CALL") {
        errorResponse(res, { message: "This number is on Do Not Call and cannot be dialed." }, 409);
        return;
      }
    }

    const userClient = await getTwilioClient(agentId);

    // Fetch amdEnabled from CallSettings (Req 4.5, 4.6)
    let amdEnabled = false;
    try {
      const agentSettings = await prisma.system_Setting.findFirst({
        where: { userId: agentId },
        include: { callSettings: true }
      });
      amdEnabled = agentSettings?.callSettings[0]?.amdEnabled ?? false;
    } catch (e) {
      console.warn(`[startCalling] Failed to fetch CallSettings for AMD check (userId: ${agentId}):`, e);
      // amdEnabled stays false — safe default (Req 4.6)
    }

    const call = await userClient.calls.create({
      to: to, // Lead Number (here the number is dynamic for now on testing account i've only 1 verified caller ID)
      url: `${envConfig.BACKEND_URL}/api/calling/webhooks/voice?agentId=${agentId}`,
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      from: from || fromNumber,
      // applicationSid:"APd8c43edcdeb39fb09d7d904eeec31271",    
      timeout: 30,
      ...(amdEnabled ? {
        machineDetection: "DetectMessageEnd",
        asyncAmd: "true",
        asyncAmdStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/amd-status?agentId=${agentId}&amdEnabled=true`,
        asyncAmdStatusCallbackMethod: "POST",
      } : {}),
    });

    console.log("Single Test Call SID:", call.sid);

    // PERSISTENCE: Create CallRecord immediately for manual calls
    const userId = (req as any).user?.id;
    const toDigits = to.replace(/\D/g, ""); // Strip non-digits
    console.log("====================================================");
    console.log("--- DEBUG START: startCalling Persistence ---");
    console.log(`[startCalling] Time: ${new Date().toISOString()}`);
    console.log(`[startCalling] User ID from Req: ${userId}`);
    console.log(`[startCalling] Call To (original): ${to}`);
    console.log(`[startCalling] Call To (digits): ${toDigits}`);

    if (userId) {
      // Find the phone record directly and include the contact
      // We match the last 10 digits to handle country code variations (+1, 0, etc.)
      const last10 = toDigits.slice(-10);
      console.log(`[startCalling] Searching for phone containing: ${last10}`);

      const phoneRecord = await (prisma.contactPhone as any).findFirst({
        where: {
          number: { contains: last10 },
          contactId: contactId
        },
        include: { contact: true }
      });

      console.log(`[startCalling] Phone lookup result: ${phoneRecord ? 'FOUND (Phone ID: ' + phoneRecord.id + ')' : 'NOT FOUND'}`);

      if (phoneRecord && (phoneRecord as any).contact) {
        const contact = (phoneRecord as any).contact;
        try {
          // Register with dialerService for status updates
          (dialerService as any).activeCalls.set(call.sid, {
            contactId: contact.id,
            userId,
            sessionId: null,
            status: "initiated"
          });

          // Create the record. Cast to any in case schema isn't generated.
          await (prisma.callRecord as any).create({
            data: {
              callSid: call.sid,
              contactId: contact.id,
              userId,
              status: "queued",
              startTime: new Date(),
            } as any
          });
          console.log(`[startCalling] SUCCESS: CallRecord created for SID: ${call.sid}`);
        } catch (dbError: any) {
          console.error(`[startCalling] ERROR: Database insertion failed: ${dbError.message}`);
        }
      } else {
        console.warn(`[startCalling] WARN: No contact found for last10 digits: ${last10} for user ${userId}`);
      }
    } else {
      console.warn(`[startCalling] WARN: Skipping persistence - userId is missing in req.user`);
    }
    console.log("--- DEBUG END: startCalling Persistence ---");
    console.log("====================================================");

    successResponse(res, 200, "Single test call lagi!", call);
    return;
  } catch (error: any) {
    console.error("Single call failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
}

export const endCall: RequestHandler = async (req, res) => {
  try {
    const { callSid } = req.body;
    if (!callSid) {
      errorResponse(res, { message: "Call SID is required" }, 400);
      return;
    }

    console.log("Terminating call session for SID:", callSid);

    // Resolve the root call to ensure both legs are dropped
    // Find who owns this call to get the right client
    const callRecord = await prisma.callRecord.findFirst({
      where: { callSid }
    });

    // Fallback to memory if DB record not found (e.g. child leg)
    const metadata = (dialerService as any).activeCalls.get(callSid);
    const userId = callRecord?.userId || metadata?.userId;
    const userClient = userId ? await getTwilioClient(userId) : client;

    const currentCall = await userClient.calls(callSid).fetch();
    const targetSid = currentCall.parentCallSid || callSid;

    console.log(`Resolved termination target: ${targetSid} (Original: ${callSid})`);
    const call = await userClient.calls(targetSid).update({ status: 'completed' });

    successResponse(res, 200, "Call session terminated successfully", call);
    return;
  } catch (error: any) {
    console.error("End call failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
}

export const resumeCall: RequestHandler = async (req, res) => {
  const twiml = new VoiceResponse();
  const agentIdentity = req.query.agentId as string;

  console.log("[resumeCall] Reconnecting customer to agent:", agentIdentity);

  twiml.say("Reconnecting you now.");
  const dial = twiml.dial();
  dial.client(agentIdentity);

  res.type("text/xml");
  res.send(twiml.toString());
};

export const stopDialing: RequestHandler = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
    }
    // Explicitly reset the agent block state so they aren't phantom-locked!
    (dialerService as any).setAgentBusy(userId, false);
    await dialerService.clearQueue(userId);
    console.log(`[stopDialing] Queue cleared and lock released for user ${userId}`);
    successResponse(res, 200, "Simultaneous dialing queue stopped", null);
    return;
  } catch (error: any) {
    errorResponse(res, { message: error.message });
    return;
  }
};

export const removeContactFromPowerQueue: RequestHandler = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { contactId, exceptQueueCardId } = req.body;

    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
    }

    if (!contactId) {
      errorResponse(res, { message: "contactId is required" }, 400);
      return;
    }

    // With exceptQueueCardId the caller wants only the queue trimmed (keep one
    // card). Otherwise this is a full removal (Trash / DNC / Contacted): purge
    // the contact from the whole session so none of its OTHER numbers get
    // dialed or redialed — cancels pending redials and hangs up its other legs.
    const removed = exceptQueueCardId
      ? dialerService.removeQueuedContactCards(userId, contactId, exceptQueueCardId)
      : await dialerService.purgeContactFromSession(userId, contactId);
    successResponse(res, 200, "Contact removed from session", { removed });
  } catch (error: any) {
    errorResponse(res, { message: error.message || "Failed to remove queued phone cards" }, 500);
  }
};

export const agentReady: RequestHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
    }

    await dialerService.agentReady(userId);
    successResponse(res, 200, "Agent ready for next call", null);
    return;
  } catch (error: any) {
    errorResponse(res, { message: error.message });
    return;
  }
};

/**
 * Bulk add leads to the database and priority queue
 */
export const addLeadsToDialer: RequestHandler = async (req, res) => {
  try {
    const { leads, callerId, callerIds, maxCallsPerId }: { leads: any[], callerId?: string, callerIds?: string | string[], pacing?: number, maxCallsPerId?: number } = req.body;
    let pacing: number | undefined = req.body.pacing;
    const userId = req.user?.id;

    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
    }

    // Clamp the requested pacing (simultaneous lines) to the plan's cap.
    // Defense in depth — the call-settings modal should already cap the
    // dropdown, but this is the actual point a dialing session takes effect.
    if (pacing != null) {
      const limits = await getUserPlanLimits(userId);
      if (limits.maxDialerLines != null && pacing > limits.maxDialerLines) {
        pacing = limits.maxDialerLines;
      }
    }

    // Explicitly reset the agent block state so they aren't phantom-locked from a previous dropped run!
    (dialerService as any).setAgentBusy(userId, false);

    // ADD THIS: Purge stale activeCalls from previous sessions
    for (const [sid, metadata] of (dialerService as any).activeCalls.entries()) {
      if (metadata.userId === userId) {
        (dialerService as any).activeCalls.delete(sid);
      }
    }

    if (!leads || !Array.isArray(leads)) {
      errorResponse(res, { message: "Invalid leads format. Expected an array." }, 400);
      return;
    }

    // 1. Mandatory DNC Filter: Exclude any numbers that belong to a DNC contact or DNC system folder
    const dncFolder = await prisma.contactFolder.findFirst({
      where: { name: "Do Not Call", isSystem: true }
    });

    const incomingPhones = leads.map((l) => l.phone);
    const dncContacts = await prisma.contact.findMany({
      where: {
        phones: { some: { number: { in: incomingPhones } } },
        OR: [
          { status: "DO_NOT_CALL" },
          dncFolder ? { folderIds: { has: dncFolder.id } } : {}
        ]
      },
      select: { phones: { select: { number: true } } }
    });

    const dncPhones = new Set(dncContacts.flatMap(c => (c as any).phones.map((p: any) => p.number)));
    const filteredLeads = leads.filter(l => !dncPhones.has(l.phone));

    if (filteredLeads.length === 0 && leads.length > 0) {
      errorResponse(res, { message: "All provided leads are on the Do Not Call list and were skipped." }, 403);
      return;
    }

    // 2. Separate leads into those that exist and those that don't
    const phones = filteredLeads.map((l) => l.phone);
    const existingLeads = await prisma.lead.findMany({
      where: {
        userId,
        phone: { in: phones },
      },
    });

    const existingPhonesMap = new Map(existingLeads.map((l) => [l.phone, l]));

    const savedLeads: any[] = [];
    for (const leadChunk of chunkArray(leads, 50)) {
      // FIX: process lead writes in batches to avoid a large burst of concurrent Prisma queries.
      const chunkResults = await Promise.all(
        leadChunk.map(async (l) => {
          const existing = existingPhonesMap.get(l.phone);
          if (existing) {
            return prisma.lead.update({
              where: { id: existing.id },
              data: {
                fullName: l.fullName,
                priority: l.priority || 0,
                email: l.email || "",
                address: l.address || "",
                city: l.city || "",
                state: l.state || "",
                zip: l.zip || "",
                phoneType: l.phoneType || "MOBILE",
                status: "PENDING",
              },
            });
          }

          return prisma.lead.create({
            data: {
              fullName: l.fullName,
              phone: l.phone,
              priority: l.priority || 0,
              email: l.email || "",
              address: l.address || "",
              city: l.city || "",
              state: l.state || "",
              zip: l.zip || "",
              phoneType: l.phoneType || "MOBILE",
              userId: userId,
              status: "PENDING",
            },
          });
        })
      );
      savedLeads.push(...chunkResults);
    }

    // 2. Pre-check compliance
    const compliance = await dialerService.checkCompliance(userId);
    if (!compliance.autodialingEnabled) {
      errorResponse(res, { message: "Autodialing is disabled in your Compliance settings." }, 403);
      return;
    }
    if (!compliance.isAllowed) {
      errorResponse(res, { message: "Cannot dial: Outside permitted calling hours (TCPA)." }, 403);
      return;
    }

    // 3. Add to Dialer Queue — pass pacing alongside caller IDs
    const leadPayloadByPhone = new Map(leads.map((l: any) => [l.phone, l]));
    await dialerService.addLeadsToQueue(
      userId,
      savedLeads.map((l) => {
        const originalPayload = leadPayloadByPhone.get(l.phone) || {};
        return ({
        id: l.id,
        fullName: l.fullName,
        phone: l.phone,
        priority: l.priority,
        userId: userId,
          originalContactId: originalPayload.contactId || originalPayload.id,
          queueCardId: originalPayload.id || l.id,
          phoneIndex: originalPayload.phoneIndex,
        });
      }),
      callerIds || callerId, // Pass selected caller IDs (array) or ID (string) to service
      pacing,             // Pass session-level pacing override
      maxCallsPerId       // Pass dials-per-caller-ID limit
    );

    successResponse(res, 200, "Leads saved to DB and added to queue!", {
      count: savedLeads.length,
    });
    return;
  } catch (error: any) {
    console.error("Error adding leads:", error);
    errorResponse(res, { message: error.message });
    return;
  }
};

/**
 * Get current dialer status and queue
 */
export const getDialerStatus: RequestHandler = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      errorResponse(res, { message: "Unauthorized" }, 401);
      return;
    }
    const status = dialerService.getStatus(userId);
    successResponse(res, 200, "Dialer status fetched", status);
    return;
  } catch (error: any) {
    errorResponse(res, { message: error.message });
    return;
  }
};

/**
 * Debug: live in-memory dialer state for one user (queue, active calls + ages,
 * agent lock owner, post-call flag, frozen caller IDs, watchdog status). Lets
 * a stuck session be inspected directly instead of grepping multi-user logs.
 * Any user may inspect themselves; ADMIN/OWNER may inspect anyone via :userId.
 */
export const getDialerDebug: RequestHandler = async (req, res) => {
  try {
    const requester = req.user;
    if (!requester?.id) {
      errorResponse(res, { message: "Unauthorized" }, 401);
      return;
    }
    const targetUserId = (req.params.userId || requester.id) as string;
    const role = (requester as any).role;
    if (targetUserId !== requester.id && role !== "ADMIN" && role !== "OWNER") {
      errorResponse(res, { message: "Forbidden" }, 403);
      return;
    }
    const state = dialerService.getDebugState(targetUserId);
    successResponse(res, 200, "Dialer debug state", state);
    return;
  } catch (error: any) {
    errorResponse(res, { message: error.message });
    return;
  }
};

/**
 * TwiML Webhook: Triggered when Twilio picks up the call
 */
export const handleVoiceWebhook: RequestHandler = async (req, res) => {
  const twiml = new VoiceResponse();
  const body = req.body;

  // Robust parameter extraction
  const to = body.To || req.query.To;
  const from = body.From || req.query.From || "";
  const caller = body.Caller || req.query.Caller || "";
  const fromValue = Array.isArray(from) ? from[0] : from;
  const callerValue = Array.isArray(caller) ? caller[0] : caller;
  const browserIdentity = [callerValue, fromValue].find(
    (value): value is string => typeof value === "string" && value.startsWith("client:")
  ) || "";
  const isBrowserOrigin = browserIdentity.startsWith("client:");
  let agentId = body.agentId || req.query.agentId || req.params.agentId;
  const contactId = body.contactId || req.query.contactId || req.params.contactId || "";
  const leadId = body.leadId || req.query.leadId || req.params.leadId || "";
  const queueCardId = body.queueCardId || req.query.queueCardId || "";
  const answeringMachineUrl = body.answeringMachineUrl || req.query.answeringMachineUrl || "";
  const busyRecordingUrl = body.busyRecordingUrl || req.query.busyRecordingUrl || "";
  const callerId = body.callerId || req.query.callerId || envConfig.TWILIO_PHONE_NUMBER;

  if ((!agentId || agentId === 'undefined' || agentId === 'null') && isBrowserOrigin) {
    agentId = browserIdentity.split(':')[1];
    console.log(`[VoiceWebhook] Extracted agentId ${agentId} from caller identity.`);
  }

  // Plan gate: only attach Twilio's <Dial record> attribute (and thus create
  // a recording) when the owning admin's plan has callRecordingEnabled. Fails
  // open (recording on) if agentId can't be resolved — same fail-open pattern
  // getUserPlanLimits itself uses for missing/unmatched plans.
  let callRecordingEnabled = true;
  if (agentId && agentId !== 'undefined' && agentId !== 'null') {
    try {
      const limits = await getUserPlanLimits(agentId);
      callRecordingEnabled = limits.callRecordingEnabled;
    } catch (err: any) {
      console.error(`[VoiceWebhook] Plan limits lookup failed for ${agentId}, defaulting recording to enabled:`, err.message);
    }
  }


  console.log("================= Voice Webhook Dispatcher ================");
  console.log("Caller:", callerValue);
  console.log("To:", to);
  console.log("From:", fromValue);
  console.log("BrowserIdentity:", browserIdentity || "<none>");
  console.log("AgentId:", agentId);
  console.log("ContactId:", contactId);



  // PERSISTENCE: Create CallRecord for browser-initiated calls if not present
  if (isBrowserOrigin && agentId) {
    try {
      // Register with dialerService for status tracking
      (dialerService as any).activeCalls.set(body.CallSid, {
        userId: agentId,
        leadId: contactId,
        contactId: contactId,
        queueCardId: queueCardId || contactId,
        sessionId: null,
        isBrowserCall: true,
        status: "initiated"
      });

      // Best-effort: record which Caller ID (from number) was used, so the
      // contact's Call History can show it for manual calls too.
      let manualCallerIdId: string | null = null;
      try {
        const fromNum = typeof callerId === "string" ? callerId : "";
        if (fromNum) {
          const cid = await prisma.callerId.findFirst({
            where: { twillioNumber: fromNum },
            select: { id: true },
          });
          manualCallerIdId = cid?.id ?? null;
        }
      } catch { /* non-fatal */ }

      await prisma.callRecord.create({
        data: {
          callSid: body.CallSid,
          userId: agentId,
          contactId: contactId,
          callerIdId: manualCallerIdId,
          status: "initiated",
          startTime: new Date(),
        }
      });
      console.log(`[VoiceWebhook] SUCCESS: CallRecord created for Browser Call: ${body.CallSid}`);
    } catch (dbError: any) {
      console.error(`[VoiceWebhook] ERROR: CallRecord creation failed: ${dbError.message}`);
    }
  }

  const start = twiml.start();
  start.transcription({
    track: "both_tracks",
    statusCallbackUrl: `${envConfig.BACKEND_URL}/api/calling/webhooks/transcription`,
  });

  const amRecordingUrl = req.query.amRecordingUrl as string;
  const AnsweredBy = body.AnsweredBy || body.answered_by;
  const currentCallSid = body.CallSid || body.call_sid || req.query.CallSid;

  console.log(`[VoiceWebhook] Processing ${currentCallSid} (AnsweredBy: ${AnsweredBy || 'none'})`);

  // 0. Handle Synchronous AMD if active
  if (AnsweredBy) {
    const answeredByStr = String(AnsweredBy).toLowerCase();
    const isMachine = answeredByStr.startsWith('machine') || answeredByStr === 'fax';
    if (isMachine) {
      console.log(`[VoiceWebhook] Machine detected for ${currentCallSid}. Playing voicemail.`);
      try {
        await prisma.callRecord.update({
          where: { callSid: currentCallSid },
          data: { disposition: "MACHINE", status: "machine-detected" }
        });
      } catch (e) { }

      if (amRecordingUrl) {
        twiml.play(amRecordingUrl);
      }
      twiml.hangup();
      res.type("text/xml");
      res.send(twiml.toString());
      return;
    }
  }

  // CASE A: Standard Outbound (Client-to-PSTN)
  if (isBrowserOrigin) {
    console.log("[VoiceWebhook] Browser-to-PSTN Call detected");

    // Mark agent as busy for manual calls too, so the power dialer knows they are occupied!
    if (agentId) {
      dialerService.setAgentBusy(agentId, true, body.CallSid);
    }

    const dial = twiml.dial({
      callerId: callerId,
      ...(callRecordingEnabled
        ? {
            record: "record-from-answer-dual" as const,
            recordingStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status?contactId=${encodeURIComponent(contactId || "")}&leadId=${encodeURIComponent(leadId || "")}`,
          }
        : {}),
    });
    dial.number({
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status?agentId=${agentId}`,
      statusCallbackMethod: "POST",
    }, to);
  }
  // CASE B: Bridged Call or Inbound
  else {
    console.log(`[VoiceWebhook] Bridge request for ${currentCallSid} -> Agent ${agentId}`);

    // AsyncAMD is running — hold the contact here instead of immediately bridging.
    // handleAmdStatus will redirect the call to bridge the agent once the AMD result
    // confirms it's a human. Without this the agent hears 2-5 seconds of machine audio.
    if (req.query.amdEnabled === 'true') {
      console.log(`[VoiceWebhook] AsyncAMD pending for ${currentCallSid} — holding call for AMD result.`);
      // Hold longer than makeCall's 20s machineDetectionTimeout so the AMD result
      // (and the bridge/hangup redirect it triggers) always lands before this pause
      // expires. A slow or silent human is bridged instead of being dropped at 25s.
      twiml.pause({ length: 30 });
      twiml.hangup();
      res.type("text/xml");
      res.send(twiml.toString());
      return;
    }

    if (!agentId || agentId === 'undefined' || agentId === 'null') {
      console.error("[VoiceWebhook] Missing or invalid agentId for bridge request.");
      twiml.say("We are unable to connect you to an agent right now.");
      twiml.hangup();
      res.type("text/xml");
      res.send(twiml.toString());
      return;
    }

    const isBusyBoolean = dialerService.isAgentBusy(agentId);
    const isInPostCall = dialerService.isAgentInPostCall(agentId);
    const activeLockOwner = (dialerService as any).agentBridgedCallId.get(agentId);
    const isLockOwnerStale = activeLockOwner && !(dialerService as any).activeCalls.has(activeLockOwner);

    // Agent is busy if: actively bridged to another call OR in post-call disposition state
    const isActuallyBusy =
      isInPostCall ||
      (isBusyBoolean && activeLockOwner && activeLockOwner !== currentCallSid && !isLockOwnerStale);

    if (isActuallyBusy) {
      const reason = isInPostCall ? "in post-call disposition" : `locked by ${activeLockOwner}`;
      console.log(`[VoiceWebhook] Agent ${agentId} is busy (${reason}). Putting ${currentCallSid} on hold.`);

      // ── POWER DIALER: Mark as callback in metadata so the UI shows Amber instead of Green ──
      const existingMeta = (dialerService as any).activeCalls.get(currentCallSid);
      if (existingMeta) {
        existingMeta.status = "callback";
        (dialerService as any).activeCalls.set(currentCallSid, existingMeta);
      }

      // ── POWER DIALER: Play on-hold audio instead of hanging up immediately ───
      const defaultHoldMusic = "https://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3";
      const holdUrl = busyRecordingUrl || defaultHoldMusic;

      // Use <Play loop="1"> so the customer hears music for ~10 seconds,
      // then we hang up and schedule a redial via requeueLeadForRedial.
      twiml.play(holdUrl);
      twiml.hangup();

      // Redial is handled in services.ts when the call actually completes.

      res.type("text/xml");
      res.send(twiml.toString());
      return;
    }

    // Acquire lock and update active call metadata
    dialerService.setAgentBusy(agentId, true, currentCallSid);

    const existingMeta = (dialerService as any).activeCalls.get(currentCallSid);
    (dialerService as any).activeCalls.set(currentCallSid, {
      userId: agentId,
      leadId: existingMeta?.leadId || contactId,
      contactId: existingMeta?.contactId || contactId,
      queueCardId: existingMeta?.queueCardId || queueCardId || contactId,
      sessionId: existingMeta?.sessionId || null,
      isBrowserCall: false,
      status: "in-progress"
    });

    // bridgeCallerId must be a verified Twilio number so the agent browser leg is accepted.
    // body.From  = the Twilio number we used to dial the customer (e.g. +18782061927) ✅
    // body.To    = the customer's PSTN number (e.g. +923152557056)                   ❌
    // Prefer the explicit env var; fall back to body.From which is always a Twilio number.
    const bridgeCallerId = body.From || envConfig.TWILIO_PHONE_NUMBER;

    const dial = twiml.dial({
      callerId: bridgeCallerId,
      answerOnBridge: true, // Customer is answered now, bridge to agent
      ...(callRecordingEnabled
        ? {
            record: "record-from-answer-dual" as const,
            // Pass contact/lead context so the recording can be attached to the right
            // CallRecord even when the recording's CallSid is a bridge child leg (the
            // power-dialer case, where SID-only matching was dropping recordings).
            recordingStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status?contactId=${encodeURIComponent(contactId || "")}&leadId=${encodeURIComponent(leadId || "")}`,
          }
        : {}),
    });

    const clientNode = dial.client({
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status?agentId=${agentId}`,
      statusCallbackMethod: "POST",
    }, agentId);

    // Tag this as a power dialer bridge so the frontend can auto-accept it
    clientNode.parameter({ name: 'dialerBridge', value: 'true' });
    if (contactId) {
      clientNode.parameter({ name: 'contactId', value: contactId });
    }
    if (existingMeta?.queueCardId || queueCardId) {
      clientNode.parameter({ name: 'queueCardId', value: existingMeta?.queueCardId || queueCardId });
    }
  }

  res.type("text/xml");
  res.send(twiml.toString());
  return;
};


// Escape a value for safe interpolation into a hand-built TwiML/XML string.
// Critical for URLs: callback URLs contain '&' between query params, which is an
// illegal raw character in XML attributes and makes Twilio reject the whole
// document ("An application error has occurred"), silently breaking the bridge.
const escapeXml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// For answering machine. WEbhoook
export const handleAmdStatus: RequestHandler = async (req, res) => {
  try {
    const { CallSid, AnsweredBy } = req.body;
    const answeringMachineUrl = req.query.answeringMachineUrl as string;
    const agentId = req.query.agentId as string;
    // Parse amdEnabled from query string — only "true" is truthy (Req 3.8)
    const amdEnabled = req.query.amdEnabled === 'true';

    console.log(`[AMD] Call ${CallSid} answered by: ${AnsweredBy} (amdEnabled: ${amdEnabled})`);

    // Recognised machine values (Req 7.1)
    const MACHINE_VALUES = ['machine_start', 'machine_end_beep', 'machine_end_silence', 'machine_end_other', 'fax'];
    const HUMAN_VALUES = ['human', 'unknown'];
    const answeredByStr = (AnsweredBy || '').toLowerCase();
    const isMachine = MACHINE_VALUES.includes(answeredByStr);
    const isHuman = HUMAN_VALUES.includes(answeredByStr);

    // Log unrecognised AnsweredBy values (Req 7.1)
    if (!isMachine && !isHuman) {
      console.warn(`[AMD] Unrecognised AnsweredBy value "${AnsweredBy}" for ${CallSid}. Treating as human.`);
      res.sendStatus(200);
      return;
    }

    if (isMachine) {
      console.log(`[AMD] Machine detected for ${CallSid}.`);

      // Fetch CallRecord for timing and ownership info (Req 6.2, 6.3)
      let callRecord: any = null;
      try {
        callRecord = await (prisma.callRecord as any).findUnique({ where: { callSid: CallSid } });
      } catch (e) {
        console.warn(`[AMD] Could not fetch CallRecord for ${CallSid}:`, e);
      }

      // Calculate duration (Req 6.2, 6.3)
      const endTime = new Date();
      let duration = 0;
      if (callRecord?.startTime) {
        duration = Math.floor((endTime.getTime() - new Date(callRecord.startTime).getTime()) / 1000);
      } else if (!callRecord) {
        console.warn(`[AMD] CallRecord not found for ${CallSid}. Duration set to 0.`);
      } else {
        console.warn(`[AMD] CallRecord.startTime is null for ${CallSid}. Duration set to 0.`);
      }

      // Update CallRecord with machine disposition (Req 6.1, 6.2)
      try {
        await (prisma.callRecord as any).update({
          where: { callSid: CallSid },
          data: { disposition: "MACHINE", status: "machine-detected", endTime, duration }
        });
      } catch (e: any) {
        console.warn(`[AMD] Could not update CallRecord for ${CallSid} (may not exist): ${e.message}`);
      }

      if (amdEnabled) {
        // ── SKIP-ON-MACHINE path (Req 3.1, 3.2) ──────────────────────────────
        console.log(`[AMD] amdEnabled=true — skipping call ${CallSid}, advancing queue.`);

        const metadata = (dialerService as any).activeCalls.get(CallSid);
        const userId = callRecord?.userId || metadata?.userId || agentId;
        // Fall back to callRecord when call-status webhook already deleted metadata
        const leadId = metadata?.leadId || callRecord?.leadId;

        // 1. Stamp as machine-detected so a racing call-status webhook skips redial,
        //    then remove from activeCalls BEFORE processQueue (Req 3.2)
        if (metadata) {
          metadata.status = "machine-detected";
          (dialerService as any).activeCalls.set(CallSid, metadata);
        }
        (dialerService as any).activeCalls.delete(CallSid);

        // 2. Update lead status to MACHINE (Req 6.1)
        if (leadId) {
          await dialerService.updateLeadStatusInDB(leadId, "MACHINE");
        }

        // 2b. Purge this lead from pendingRedials and the queue in case a racing
        //     call-status webhook already scheduled a redial before AMD fired.
        //     cancelPendingRedial clears the actual setTimeout handle — deleting the
        //     guard key alone does NOT stop an already-scheduled timer, which is what
        //     caused the same machine number to be dialed 2-3 times before dropping.
        if (userId) {
          const contactId = metadata?.contactId || callRecord?.contactId;
          // metadata (and thus queueCardId) may already be gone, so cancel by every
          // candidate key the redial could have been scheduled under.
          [metadata?.queueCardId, contactId, leadId].forEach((key) => {
            if (key) dialerService.cancelPendingRedial(userId, key);
          });
          if (contactId) {
            dialerService.removeQueuedContactCards(userId, contactId);
          }
        }

        // 3. Hang up the call (Req 3.1)
        try {
          const userClient = await getTwilioClient(userId || agentId);
          await userClient.calls(CallSid).update({ status: 'completed' });
        } catch (hangupErr: any) {
          console.error(`[AMD] Hangup failed for ${CallSid}:`, hangupErr.message);
          // Mark for manual cleanup (Req 7.2)
          try {
            await (prisma.callRecord as any).update({
              where: { callSid: CallSid },
              data: { status: "hangup-failed" }
            });
          } catch (e) { /* non-fatal */ }
        }

        // 4. Advance the queue (Req 3.2)
        if (userId) {
          (dialerService as any).processQueue(userId);
        }

      } else {
        // ── EXISTING VOICEMAIL-DROP path (Req 3.3, 3.4) ──────────────────────
        const userClient = await getTwilioClient(agentId);
        if (answeringMachineUrl) {
          console.log(`[AMD] Dropping out-of-band voicemail for ${CallSid}`);
          await userClient.calls(CallSid).update({
            twiml: `<Response>
                        <Play>${escapeXml(answeringMachineUrl)}</Play>
                        <Hangup/>
                    </Response>`
          });
        } else {
          console.log(`[AMD] No voicemail configured. Hanging up ${CallSid}`);
          await userClient.calls(CallSid).update({ status: 'completed' });
        }
      }

    } else {
      // Human confirmed — bridge the agent now that we know it's a person.
      // The voice webhook returned <Pause> so the agent was never connected yet.
      console.log(`[AMD] Human/unknown confirmed for ${CallSid} — bridging to agent ${agentId}.`);

      const amdContactId  = (req.query.contactId  as string) || '';
      const amdLeadId     = (req.query.leadId      as string) || '';
      const amdQueueCardId = (req.query.queueCardId as string) || '';
      const callerFrom    = (req.query.callerFrom  as string) || '';
      const amdBusyUrl    = (req.query.busyRecordingUrl as string) || '';

      if (!agentId) {
        console.warn(`[AMD] No agentId for ${CallSid} — cannot bridge.`);
        res.sendStatus(200);
        return;
      }

      try {
        const userClient = await getTwilioClient(agentId);
        const isBusy = dialerService.isAgentBusy(agentId);
        const isInPostCall = dialerService.isAgentInPostCall(agentId);

        if (isBusy || isInPostCall) {
          // Agent took another call during the AMD wait — this is a live human we
          // can't connect right now. Mark the leg as 'callback' (parity with the
          // non-AMD overflow path in handleVoiceWebhook) so its terminal call-status
          // webhook schedules a redial. Without this stamp the call ends as
          // 'completed' and falls through every redial branch — the answered human
          // is dropped and never called back.
          const existingMeta = (dialerService as any).activeCalls.get(CallSid);
          if (existingMeta) {
            existingMeta.status = "callback";
            existingMeta.amdPending = false;
            (dialerService as any).activeCalls.set(CallSid, existingMeta);
          }
          // Hold this contact for redial.
          const holdUrl = amdBusyUrl || "https://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3";
          await userClient.calls(CallSid).update({
            twiml: `<Response><Play>${escapeXml(holdUrl)}</Play><Hangup/></Response>`
          });
          console.log(`[AMD] Agent ${agentId} busy — playing hold for ${CallSid}, redial scheduled on completion.`);
        } else {
          // Guard: if the call was already terminated (status callback beat us here),
          // activeCalls will have been deleted. Acquiring the lock on a dead call
          // would permanently wedge the agent's busy state.
          const callStillActive = (dialerService as any).activeCalls.has(CallSid);
          if (!callStillActive) {
            console.warn(`[AMD] Call ${CallSid} already removed from activeCalls before AMD human result arrived. Skipping bridge to avoid stuck lock.`);
            res.sendStatus(200);
            return;
          }

          // Acquire agent lock and update metadata before bridging
          dialerService.setAgentBusy(agentId, true, CallSid);
          const existingMeta = (dialerService as any).activeCalls.get(CallSid);
          (dialerService as any).activeCalls.set(CallSid, {
            userId: agentId,
            leadId:      existingMeta?.leadId      || amdLeadId,
            contactId:   existingMeta?.contactId   || amdContactId,
            queueCardId: existingMeta?.queueCardId || amdQueueCardId || amdContactId,
            sessionId:   existingMeta?.sessionId   || null,
            isBrowserCall: false,
            amdPending: false,
            status: 'in-progress',
          });

          const bridgeCallerId = callerFrom || envConfig.TWILIO_PHONE_NUMBER;
          const effectiveQueueCardId = existingMeta?.queueCardId || amdQueueCardId;
          const recordingCb = `${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status?contactId=${encodeURIComponent(amdContactId)}&leadId=${encodeURIComponent(amdLeadId)}`;
          const statusCb    = `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status?agentId=${agentId}`;

          try {
            await userClient.calls(CallSid).update({
              twiml: `<Response><Dial callerId="${escapeXml(bridgeCallerId)}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(recordingCb)}"><Client statusCallbackEvent="initiated ringing answered completed" statusCallback="${escapeXml(statusCb)}" statusCallbackMethod="POST"><Identity>${escapeXml(agentId)}</Identity><Parameter name="dialerBridge" value="true"/>${amdContactId ? `<Parameter name="contactId" value="${escapeXml(amdContactId)}"/>` : ''}${effectiveQueueCardId ? `<Parameter name="queueCardId" value="${escapeXml(effectiveQueueCardId)}"/>` : ''}</Client></Dial></Response>`
            });
            console.log(`[AMD] Human confirmed — bridged ${CallSid} to agent ${agentId}.`);
          } catch (bridgeErr: any) {
            console.error(`[AMD] Bridge failed for ${CallSid} — releasing lock to unblock agent:`, bridgeErr.message);
            // The call is dead but the lock was already acquired — release it now
            // so the agent isn't stuck waiting for a call that will never connect.
            dialerService.setAgentBusy(agentId, false);
            (dialerService as any).activeCalls.delete(CallSid);
          }
        }
      } catch (bridgeErr: any) {
        console.error(`[AMD] Bridge failed for ${CallSid}:`, bridgeErr.message);
      }
    }

    res.sendStatus(200);
    return;
  } catch (error: any) {
    console.error('[AMD] Status handling failed:', error);
    res.sendStatus(200); // Always 200 to Twilio (Req 7.2)
    return;
  }
};


export const dropVoicemail: RequestHandler = async (req, res) => {
  try {
    const { callSid, voicemailUrl } = req.body;

    if (!callSid || !voicemailUrl) {
      errorResponse(res, { message: "callSid and voicemailUrl are required" }, 400);
      return;
    }

    console.log(`[DropVoicemail] Dropping voicemail for ${callSid}`);

    // Find the customer leg
    const callRecord = await prisma.callRecord.findFirst({ where: { callSid } });
    const userClient = callRecord ? await getTwilioClient(callRecord.userId) : client;

    const currentCall = await userClient.calls(callSid).fetch();
    const childCalls = await userClient.calls.list({ parentCallSid: callSid });
    const customerLeg = childCalls.find(c =>
      ['in-progress', 'ringing', 'answered'].includes(c.status)
    ) || currentCall;

    // Play voicemail to customer and hang up
    await userClient.calls(customerLeg.sid).update({
      twiml: `<Response>
                <Play>${escapeXml(voicemailUrl)}</Play>
                <Hangup/>
            </Response>`
    });

    successResponse(res, 200, "Voicemail dropped successfully", { callSid });
    return;
  } catch (error: any) {
    console.error('[DropVoicemail] Failed:', error);
    errorResponse(res, { message: error.message });
    return;
  }
};


/**
 * RecordingStatus Webhook: Triggered when recording is ready
 */
export const handleRecordingStatus: RequestHandler = async (req, res) => {
  try {
    const { CallSid, RecordingUrl, RecordingStatus, RecordingSid } = req.body;
    const contactId = (req.query.contactId as string) || "";
    const leadId = (req.query.leadId as string) || "";
    console.log(`Recording ready for Call ${CallSid}: ${RecordingUrl} (${RecordingStatus}) [contactId=${contactId || "-"} leadId=${leadId || "-"}]`);
    if (RecordingStatus === 'completed') {
      await dialerService.handleRecordingUpdate(CallSid, RecordingUrl, RecordingSid, { contactId, leadId });
    }

    successResponse(res, 200, "Recording status received", req.body);
    return;
  } catch (error: any) {
    console.error("Recording webhook error:", error);
    errorResponse(res, { message: error.message });
    return;
  }
}

/**
 * Transcription Webhook: Triggered for each transcription fragment
 */
export const handleTranscriptionWebhook: RequestHandler = async (req, res) => {
  try {
    const { CallSid, TranscriptionData, Track } = req.body;
    console.log("[TranscriptionDataJSON]  ", JSON.stringify(TranscriptionData))
    // Twilio sends TranscriptionData as a JSON string or object
    const data = typeof TranscriptionData === 'string' ? JSON.parse(TranscriptionData) : TranscriptionData;

    if (data && data.transcript) {
      // Diagnostic analysis showed:
      // inbound_track -> "Welcome back to productivity..." (Agent)
      // outbound_track -> "Hello.", "Okay." (Customer)
      const track = (data.track || data.Track || Track || '').toLowerCase();
      const speaker = track.includes('inbound') ? 'AGENT' : 'CUSTOMER';

      dialerService.addTranscription(CallSid, speaker, data.transcript);
    }

    res.sendStatus(200);
    return;
  } catch (error: any) {
    console.error("Transcription webhook error:", error);
    res.sendStatus(200); // Always respond 200 to Twilio
    return;
  }
}

/**
 * API: Get transcription logs for the UI
 */
export const getTranscriptionLogs: RequestHandler = async (req, res) => {
  try {
    const logs = dialerService.getTranscriptionLogs();
    successResponse(res, 200, "Transcription logs fetched", { logs });
    return;
  } catch (error: any) {
    errorResponse(res, { message: error.message });
    return;
  }
}

/**
 * StatusCallback Webhook: Triggered on call events
 */
export const handleCallStatus: RequestHandler = async (req, res) => {
  try {
    const { CallSid, CallStatus, ParentCallSid, CallDuration } = req.body;
    const agentId = req.query.agentId as string;

    // Carrier-rejected calls can appear as 'completed' with CallDuration=0 — the
    // callee's phone briefly signalled 200 OK then immediately disconnected (common
    // with carriers in certain regions). Nobody actually answered, so we reclassify
    // these as 'no-answer' so they don't count as "contacted" in filters.
    const effectiveStatus =
      CallStatus === 'completed' && parseInt(CallDuration ?? '-1') === 0
        ? 'no-answer'
        : CallStatus;

    console.log(
      `Call ${CallSid} status update: ${CallStatus}` +
      (effectiveStatus !== CallStatus ? ` → reclassified as ${effectiveStatus} (CallDuration=0)` : '') +
      (ParentCallSid ? ` (Parent: ${ParentCallSid})` : '')
    );

    // 🔥 ONLY propagate CHILD leg updates to parent
    if (ParentCallSid) {
      // Logic association: ensures either leg can release the lock
      if ((dialerService as any).sidToRootSid) {
        (dialerService as any).sidToRootSid.set(CallSid, ParentCallSid);
      }

      await dialerService.handleCallStatusUpdate(
        ParentCallSid,
        effectiveStatus,
        true,
        agentId
      );
    }

    // Optional: handle standalone calls (no parent)
    if (!ParentCallSid) {
      await dialerService.handleCallStatusUpdate(
        CallSid,
        effectiveStatus,
        false,
        agentId
      );
    }

    successResponse(res, 200, "Call status updated", req.body);
  } catch (error: any) {
    errorResponse(res, { message: error.message });
  }
};

export const voiceCall: RequestHandler = async (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say('Hello from the multi-dialer! Integration successful.');
  res.type('text/xml');
  res.send(twiml.toString());
  return;
}

export const getAvailableUsNumbers: RequestHandler = async (req, res) => {
  try {
    const { countryCode, cityName, state, userId: targetUserId } = req.body;

    console.log("countryCode", countryCode);
    console.log("cityName", cityName);
    console.log("state", state);

    const userId = req.user?.id || "";
    let userClient = await getTwilioClient(userId);

    // Allow a super admin/owner to search for numbers on behalf of another
    // user — searched (and later bought) via the platform's MASTER Twilio
    // account rather than the target's own sub-account.
    if (targetUserId && targetUserId !== userId) {
      const callerRole = req.user?.role;
      if (callerRole !== "OWNER" && callerRole !== "SUPER_ADMIN") {
        errorResponse(res, { message: "You don't have permission to act on behalf of another user." }, 403);
        return;
      }
      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        errorResponse(res, { message: "Target user not found" }, 404);
        return;
      }
      userClient = masterClient;
    }

    const numbers = await userClient.availablePhoneNumbers(countryCode || "US").local.list({
      limit: 10,
      inLocality: cityName,
      inRegion: state,
    });

    const pricing = await userClient.pricing.v1
      .phoneNumbers
      .countries(countryCode)
      .fetch();

    if (!numbers) {
      errorResponse(res, { message: "No numbers found" });
      return;
    }

    // The actual price a purchase will be charged — mirrors the logic in
    // buyNumber/buySelfServiceAddonNumber/buyNumberOnBehalfOfUser so what's
    // shown here always matches what happens on "Buy & Add Number". Within
    // the plan's included free count it's $0; past it, the plan's configured
    // flat add-on price (extraNumberPriceCents) if set, else Twilio's live
    // price for this country (the same `pricing` payload above).
    const effectiveUserId = targetUserId || userId;
    const limits = await getUserPlanLimits(effectiveUserId);

    let isWithinIncludedCount = true;
    if (limits.includedNumbers != null) {
      const systemSettingIds = (
        await prisma.system_Setting.findMany({ where: { userId: effectiveUserId }, select: { id: true } })
      ).map((s) => s.id);
      const currentCount = await prisma.callerId.count({ where: { systemSettingId: { in: systemSettingIds } } });
      isWithinIncludedCount = currentCount < limits.includedNumbers;
    }

    let effectivePriceCents = 0;
    let effectiveCurrency = "usd";
    if (!isWithinIncludedCount) {
      if (limits.extraNumberPriceCents != null) {
        effectivePriceCents = limits.extraNumberPriceCents;
      } else {
        const priceEntry = (pricing as any)?.phoneNumberPrices?.[0];
        const amount = parseFloat(priceEntry?.current_price ?? "1.15");
        effectivePriceCents = Math.round((isNaN(amount) ? 1.15 : amount) * 100);
        effectiveCurrency = ((pricing as any)?.priceUnit || "usd").toLowerCase();
      }
    }

    const data = {
      numbers,
      pricing,
      billing: { isWithinIncludedCount, effectivePriceCents, effectiveCurrency },
    }

    console.log("numbers", data);
    successResponse(res, 200, "Available numbers fetched successfully", data);
    return;
  } catch (error: any) {
    console.log("error", error);
    console.error("Available numbers fetch failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
}

export const buyNumber: RequestHandler = async (req, res) => {
  try {
    const { phoneNumber, countryCode, label, userId: targetUserId, confirmOverageCharge } = req.body;
    const userId: string = req.user?.id || "";

    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
    }

    // Allow a super admin/owner to buy a number on behalf of another user.
    // This is always a paid add-on for the target user (billed via Stripe),
    // purchased on the platform's master Twilio account and transferred into
    // their sub-account.
    if (targetUserId && targetUserId !== userId) {
      const callerRole = req.user?.role;
      if (callerRole !== "OWNER" && callerRole !== "SUPER_ADMIN") {
        errorResponse(res, { message: "You don't have permission to act on behalf of another user." }, 403);
        return;
      }
      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        errorResponse(res, { message: "Target user not found" }, 404);
        return;
      }

      await buyNumberOnBehalfOfUser(res, targetUserId, phoneNumber, countryCode, label);
      return;
    }

    // Self-service purchase — numbers within the plan's included free count
    // buy directly from Twilio with no Stripe charge. Past that count, this
    // is a paid add-on: the first attempt is rejected with the price instead
    // of silently charging, and the caller must explicitly resubmit with
    // confirmOverageCharge:true (set after the user confirms in a dialog) —
    // same two-step "you can't add this — pay extra to unlock" pattern as
    // the agent-seat overage flow.
    const limits = await getUserPlanLimits(userId);
    if (limits.includedNumbers != null) {
      const systemSettingIds = (
        await prisma.system_Setting.findMany({ where: { userId }, select: { id: true } })
      ).map((s) => s.id);
      const currentCount = await prisma.callerId.count({
        where: { systemSettingId: { in: systemSettingIds } },
      });
      if (currentCount >= limits.includedNumbers) {
        if (!confirmOverageCharge) {
          let priceCents: number;
          let currency = "usd";
          if (limits.extraNumberPriceCents != null) {
            priceCents = limits.extraNumberPriceCents;
          } else {
            const userClientForPricing = await getTwilioClient(userId);
            const live = await getMonthlyPriceCentsForCountry(userClientForPricing, countryCode || "US");
            priceCents = live.amountCents;
            currency = live.currency;
          }
          res.status(402).json({
            success: false,
            requiresPayment: true,
            priceCents,
            currency,
            message: `Your plan includes ${limits.includedNumbers} number(s) and you've reached that limit. Adding this number costs $${(priceCents / 100).toFixed(2)}/mo.`,
          });
          return;
        }
        await buySelfServiceAddonNumber(res, userId, phoneNumber, countryCode, label, limits);
        return;
      }
    }

    const userClient = await getTwilioClient(userId);
    const number = await userClient.incomingPhoneNumbers.create({
      phoneNumber: phoneNumber,
    });

    // Save the new number to the caller ID table
    const callerIdPayload = {
      label: label || number.friendlyName || phoneNumber,
      countryCode: countryCode || "US", // Default to US if not provided
      callerId: number.phoneNumber,
      twillioSid: number.sid,
      twillioNumber: number.phoneNumber,
    };

    const newCallerId = await insertCallerIdInDb(callerIdPayload, userId);

    successResponse(res, 200, "Number bought successfully", { number, callerId: newCallerId });
    return;
  } catch (error: any) {
    console.error("Number buy failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
}

/**
 * Buys a number on the master Twilio account and charges the target user for
 * it as a paid add-on:
 *   1. preflight: sub-account + Stripe customer + payment method must exist
 *   2. buy from Twilio on the MASTER account
 *   3. charge the user (Stripe subscription item, immediate invoice)
 *   4. on success: transfer the number into their sub-account, save CallerId
 *   5. on failure at any billing/transfer step: release the number, roll back
 */
async function buyNumberOnBehalfOfUser(
  res: Response,
  targetUserId: string,
  phoneNumber: string,
  countryCode: string | undefined,
  label: string | undefined,
) {
  const subAccountSid = await getUserTwilioSubAccountSid(targetUserId);
  if (!subAccountSid) {
    errorResponse(res, { message: "This user has no Twilio sub-account configured yet." }, 400);
    return;
  }

  let billableCustomer;
  try {
    billableCustomer = await resolveBillableCustomer(targetUserId);
  } catch (err: any) {
    errorResponse(res, { message: err.message }, 400);
    return;
  }

  // Use the plan's configured flat add-on price when set (e.g. $2/number),
  // overriding Twilio's live list price so overage billing matches the
  // pricing sheet regardless of country. Only hit Twilio's pricing API when
  // no override is configured.
  const limits = await getUserPlanLimits(targetUserId);
  let amountCents: number;
  let currency: string;
  if (limits.extraNumberPriceCents != null) {
    amountCents = limits.extraNumberPriceCents;
    currency = "usd";
  } else {
    const livePricing = await getMonthlyPriceCentsForCountry(masterClient, countryCode || "US");
    amountCents = livePricing.amountCents;
    currency = livePricing.currency;
  }
  const numberLabel = label || phoneNumber;

  const purchased = await masterClient.incomingPhoneNumbers.create({ phoneNumber });

  try {
    const { stripeSubscriptionItemId } = await addNumberToAddonSubscription(
      targetUserId,
      billableCustomer.stripeCustomerId,
      billableCustomer.paymentMethodId,
      amountCents,
      currency,
      numberLabel,
    );

    try {
      await transferNumberToSubAccount(purchased.sid, subAccountSid);
    } catch (transferErr: any) {
      await removeAddonSubscriptionItem(stripeSubscriptionItemId);
      throw transferErr;
    }

    let systemSettings = await prisma.system_Setting.findFirst({ where: { userId: targetUserId } });
    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({ data: { userId: targetUserId } });
    }

    const newCallerId = await prisma.callerId.create({
      data: {
        label: numberLabel,
        countryCode: countryCode || "US",
        twillioNumber: purchased.phoneNumber,
        twillioSid: purchased.sid,
        systemSettingId: systemSettings.id,
        billingSource: "PAID_ADDON",
        monthlyPriceCents: amountCents,
        currency,
        stripeSubscriptionItemId,
        numberBillingStatus: "ACTIVE",
      },
    });

    successResponse(res, 200, "Number bought and billed successfully", { number: purchased, callerId: newCallerId });
  } catch (error: any) {
    console.error("[buyNumberOnBehalfOfUser] Billing/transfer failed, releasing number:", error.message);
    await releaseNumber(purchased.sid, masterClient).catch(() => undefined);
    errorResponse(res, { message: error.message || "Failed to charge the user for this number." }, 402);
  }
}

/**
 * Self-service paid add-on: the buyer is already the owner of their own
 * Twilio sub-account, so unlike buyNumberOnBehalfOfUser this buys directly
 * on that sub-account — no master-account purchase + transfer needed.
 *   1. resolve billable Stripe customer + payment method
 *   2. buy from Twilio on the user's own sub-account
 *   3. charge the user (Stripe subscription item, immediate invoice)
 *   4. on billing failure: release the number, roll back
 */
async function buySelfServiceAddonNumber(
  res: Response,
  userId: string,
  phoneNumber: string,
  countryCode: string | undefined,
  label: string | undefined,
  limits: Awaited<ReturnType<typeof getUserPlanLimits>>,
) {
  let billableCustomer;
  try {
    billableCustomer = await resolveBillableCustomer(userId);
  } catch (err: any) {
    errorResponse(res, { message: err.message }, 400);
    return;
  }

  const userClient = await getTwilioClient(userId);

  // Use the plan's configured flat add-on price when set, else Twilio's live
  // list price for the number's country — same fallback the on-behalf-of
  // flow uses.
  let amountCents: number;
  let currency: string;
  if (limits.extraNumberPriceCents != null) {
    amountCents = limits.extraNumberPriceCents;
    currency = "usd";
  } else {
    const livePricing = await getMonthlyPriceCentsForCountry(userClient, countryCode || "US");
    amountCents = livePricing.amountCents;
    currency = livePricing.currency;
  }
  const numberLabel = label || phoneNumber;

  const purchased = await userClient.incomingPhoneNumbers.create({ phoneNumber });

  try {
    const { stripeSubscriptionItemId } = await addNumberToAddonSubscription(
      userId,
      billableCustomer.stripeCustomerId,
      billableCustomer.paymentMethodId,
      amountCents,
      currency,
      numberLabel,
    );

    let systemSettings = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({ data: { userId } });
    }

    const newCallerId = await prisma.callerId.create({
      data: {
        label: numberLabel,
        countryCode: countryCode || "US",
        twillioNumber: purchased.phoneNumber,
        twillioSid: purchased.sid,
        systemSettingId: systemSettings.id,
        billingSource: "PAID_ADDON",
        monthlyPriceCents: amountCents,
        currency,
        stripeSubscriptionItemId,
        numberBillingStatus: "ACTIVE",
      },
    });

    successResponse(res, 200, "Number bought and billed successfully", { number: purchased, callerId: newCallerId });
  } catch (error: any) {
    console.error("[buySelfServiceAddonNumber] Billing failed, releasing number:", error.message);
    await releaseNumber(purchased.sid, userClient).catch(() => undefined);
    errorResponse(res, { message: error.message || "Failed to charge you for this number." }, 402);
  }
}

/**
 * Access Token: Generate token for Browser-based Agent
 */
export const getTwilioToken: RequestHandler = async (req, res) => {
  try {
    // Use the authenticated user's ID as identity
    const identity = req.user?.id || (req.query.identity as string) || 'tester_agent';
    const userId = req.user?.id || '';

    let accountSid = envConfig.TWILIO_ACCOUNT_SID!;
    let apiKey = envConfig.TWILIO_API_KEY || '';
    let apiSecret = envConfig.TWILIO_API_SECRET || '';
    let twimlAppSid = envConfig.TWILIO_TWIML_APP_SID || "AP2dfe20dda942797074ca416be8142b9c";

    // ── Sub-account support ────────────────────────────────────────────────────
    // If the user has their own Twilio sub-account, use those credentials so that
    // the browser Device registers under the SAME account as the one placing calls.
    // Without this, <Dial><Client> from a sub-account cannot reach a browser
    // registered on the master account.
    if (userId) {
      try {
        // Resolve effective owner (agents inherit from their admin)
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, createdById: true }
        });
        const effectiveUserId = (user?.role === 'AGENT' && user?.createdById) ? user.createdById : userId;

        const integration = await prisma.integration.findFirst({
          where: { provider: 'TWILIO', systemSetting: { userId: effectiveUserId } }
        });

        if (integration?.credentials) {
          const creds = integration.credentials as any;
          if (creds.accountSid && creds.authToken) {
            accountSid = creds.accountSid;

            // ── Ensure a real API Key exists in the sub-account ──────────────────
            // (Required for Voice SDK Access Tokens)
            let currentApiKeySid = creds.apiKeySid;
            let currentApiKeySecret = creds.apiKeySecret;
            const subClient = require('twilio')(creds.accountSid, creds.authToken);

            if (!currentApiKeySid || !currentApiKeySecret) {
              console.log(`[getTwilioToken] Creating missing API Key for sub-account: ${accountSid}`);
              try {
                const newKey = await subClient.newKeys.create({ friendlyName: 'MultiDialer Key' });
                currentApiKeySid = newKey.sid;
                currentApiKeySecret = newKey.secret;

                // Persist so we don't recreate on every token request
                await prisma.integration.update({
                  where: { id: integration.id },
                  data: { credentials: { ...creds, apiKeySid: currentApiKeySid, apiKeySecret: currentApiKeySecret } }
                });
                console.log(`[getTwilioToken] API Key created and cached: ${currentApiKeySid}`);
              } catch (keyErr: any) {
                console.error(`[getTwilioToken] Failed to create sub-account API Key:`, keyErr.message);
              }
            }

            if (currentApiKeySid && currentApiKeySecret) {
              apiKey = currentApiKeySid;
              apiSecret = currentApiKeySecret;
            } else {
              // Fallback (though it might fail on frontend)
              apiKey = creds.accountSid;
              apiSecret = creds.authToken;
            }

            // ── Ensure a TwiML App exists in the sub-account ──────────────────
            const targetVoiceUrl = `${envConfig.BACKEND_URL}/api/calling/webhooks/voice?agentId=${identity}`;

            // ── Ensure a TwiML App exists in the sub-account ──────────────────
            let appSid = creds.twimlAppSid;

            if (appSid) {
              console.log(`[getTwilioToken] Verifying cached sub-account TwiML App: ${appSid}`);
              try {
                const app = await subClient.applications(appSid).fetch();
                if (!app.voiceUrl || !app.voiceUrl.includes(`agentId=${identity}`)) {
                  console.log(`[getTwilioToken] Updating cached TwiML App voiceUrl with agentId: ${appSid}`);
                  await app.update({ voiceUrl: targetVoiceUrl });
                }
              } catch (fetchErr) {
                console.warn(`[getTwilioToken] Cached TwiML App ${appSid} not found on Twilio, resetting...`);
                appSid = null;
              }
            }

            if (!appSid) {
              try {
                const appName = 'MultiDialer Voice App';
                const existingApps = await subClient.applications.list({ friendlyName: appName, limit: 1 });

                if (existingApps.length > 0) {
                  const existingApp = existingApps[0];
                  appSid = existingApp.sid;
                  if (!existingApp.voiceUrl || !existingApp.voiceUrl.includes(`agentId=${identity}`)) {
                    console.log(`[getTwilioToken] Updating existing sub-account TwiML App with agentId: ${appSid}`);
                    await existingApp.update({ voiceUrl: targetVoiceUrl });
                  }
                  console.log(`[getTwilioToken] Found and verified existing sub-account TwiML App: ${appSid}`);
                } else {
                  const newApp = await subClient.applications.create({
                    friendlyName: appName,
                    voiceUrl: targetVoiceUrl,
                    voiceMethod: 'POST',
                  });
                  appSid = newApp.sid;
                  console.log(`[getTwilioToken] Created new sub-account TwiML App: ${appSid}`);
                }

                twimlAppSid = appSid;

                // Persist so we don't recreate on every token request
                await prisma.integration.update({
                  where: { id: integration.id },
                  data: { credentials: { ...creds, twimlAppSid: appSid } }
                });
              } catch (appErr: any) {
                console.error('[getTwilioToken] Failed to manage sub-account TwiML App:', appErr.message);
              }
            } else {
              twimlAppSid = appSid;
            }

            console.log(`[getTwilioToken] Generating token for sub-account ${accountSid}, identity: ${identity}`);
          }
        }
      } catch (integErr: any) {
        console.warn('[getTwilioToken] Could not fetch integration, using master account:', integErr.message);
      }
    }

    if (!apiKey || !apiSecret) {
      console.warn('[getTwilioToken] TWILIO_API_KEY or TWILIO_API_SECRET missing in .env.');
    }

    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity });
    const grant = new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: true });
    token.addGrant(grant);

    console.log(`[getTwilioToken] Token issued — account: ${accountSid}, twimlApp: ${twimlAppSid}, identity: ${identity}`);

    successResponse(res, 200, 'Token generated successfully', {
      identity,
      token: token.toJwt(),
    });
  } catch (error: any) {
    console.error('Token generation failed:', error);
    errorResponse(res, { message: 'Failed to generate token.' });
  }
}


export const sendSms: RequestHandler = async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { to, message, from, contactId } = req.body;
    if (!to || !message) {
      errorResponse(res, { message: "Recipient number (to) and message are required" }, 400);
      return;
    }

    // Normalize phone number immediately
    const digits = to.replace(/\D/g, "");
    const formattedTo = to.startsWith('+') ? to : (digits.length === 10 ? `+1${digits}` : `+${digits}`);
    const senderNumber = from || fromNumber;

    console.log(`[sendSms] Initiating send to ${formattedTo} from ${senderNumber}`);

    // Call Twilio - this is the part that usually takes the most time
    const userId = req.user?.id;
    const userClient = await getTwilioClient(userId || "");
    const twilioStart = Date.now();
    const service = await userClient.messages.create({
      body: message,
      from: senderNumber,
      to: formattedTo,
      // Optional: Add status callback for background tracking without blocking the agent
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/sms-status`,
    });
    const twilioEnd = Date.now();

    console.log(`[sendSms] Twilio API Response: SID=${service.sid}, Time=${twilioEnd - twilioStart}ms`);

    // Log outgoing SMS to database
    if (userId) {
      try {
        let finalContactId = contactId;

        if (!finalContactId) {
          const digits = formattedTo.replace(/\D/g, "");
          const searchNumber = digits.length > 10 ? digits.slice(-10) : digits;

          const contactPhone = await prisma.contactPhone.findFirst({
            where: { number: { contains: searchNumber } },
          });
          finalContactId = contactPhone?.contactId;
        }

        await prisma.smsLog.create({
          data: {
            to: formattedTo,
            from: senderNumber,
            content: message,
            status: "SENT",
            messageSid: service.sid,
            userId,
            contactId: finalContactId
          }
        });
      } catch (logErr) {
        console.warn("[sendSms] Failed to log SMS to DB:", logErr);
      }
    }

    successResponse(res, 200, "SMS sent successfully", {
      sid: service.sid,
      status: service.status,
      duration: twilioEnd - twilioStart
    });

    const totalTime = Date.now() - startTime;
    console.log(`[sendSms] Total request processing time: ${totalTime}ms`);
    return;
  } catch (error: any) {
    console.error(`[sendSms] FAILED after ${Date.now() - startTime}ms:`, error);
    errorResponse(res, { message: error.message });
    return;
  }
}

export const getCallsInsights: RequestHandler = async (req, res) => {
  try {
    const userId = req.user?.id || "";
    const userClient = await getTwilioClient(userId);
    const insights = await userClient.calls.list({ status: "completed", limit: 10 });
    const serializedInsights = insights.map(call => call.toJSON());

    successResponse(res, 200, "Calls insights fetched successfully", serializedInsights);
    return;
  } catch (error: any) {
    console.error("Calls insights fetch failed:", error);

    const statusCode = error.status || 500;
    const message = error.code === 20003
      ? "Twilio authentication failed. Please check your credentials."
      : error.message;

    errorResponse(res, { message }, statusCode);
    return;
  }
};


export const insights: RequestHandler = async (req: Request, res: Response) => {
  try {
    const serviceSid = process.env.TWILIO_INTELLIGENCE_SERVICE_SID;
    const { RecordingSid } = req.body;
    const userId = req.user?.id || "";
    const userClient = await getTwilioClient(userId);
    const insights = await userClient.intelligence.v2.transcripts.create({
      serviceSid: serviceSid!,
      channel: JSON.stringify({
        media_properties: {
          source_sid: RecordingSid
        }
      })
    })
    console.log(insights)

    successResponse(res, 200, "Calls insights fetched successfully", insights);
    return;
  } catch (error: any) {
    console.error("Calls insights fetch failed:", error);

    const statusCode = error.status || 500;
    const message = error.code === 20003
      ? "Twilio authentication failed. Please check your credentials."
      : error.message;

    errorResponse(res, { message }, statusCode);
    return;
  }
};


export const getHistory: RequestHandler = async (req: Request, res: Response) => {
  try {
    const agentId = req.user?.id;
    const calls = await prisma.callRecord.findMany({
      where: {
        userId: agentId,
        recordingUrl: { not: null }
      },
      include: {
        contact: true,
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });
    successResponse(res, 200, "Calls history fetched successfully", calls);
    return;
  } catch (error: any) {
    console.error("Calls history fetch failed:", error);

    const statusCode = error.status || 500;
    const message = error.code === 20003
      ? "Twilio authentication failed. Please check your credentials."
      : error.message;

    errorResponse(res, { message }, statusCode);
    return;
  }
};

export const getCallStatus: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { sid } = req.params;
    if (!sid) {
      errorResponse(res, { message: "Call SID is required" }, 400);
      return;
    }

    const callRecord = await prisma.callRecord.findUnique({
      where: { callSid: sid },
    });

    if (callRecord) {
      successResponse(res, 200, "Call status fetched successfully", {
        status: callRecord.status,
        disposition: callRecord.disposition
      });
      return;
    }

    // No DB record — fall back to Twilio REST API for live call status
    try {
      const userId = (req as any).user?.id;
      const userClient = userId ? await getTwilioClient(userId) : client;
      const twilioCall = await userClient.calls(sid).fetch();
      successResponse(res, 200, "Call status fetched successfully", {
        status: twilioCall.status,
        disposition: null
      });
      return;
    } catch (twilioErr: any) {
      // Call not found in Twilio either
    }

    errorResponse(res, { message: "Call record not found" }, 404);
    return;
  } catch (error: any) {
    console.error("Get call status failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
};

export const getCallSummary: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { sid } = req.params;
    if (!sid) {
      errorResponse(res, { message: "Call SID is required" }, 400);
      return;
    }

    // 1. Check for analysis first
    const analysis = await prisma.callAnalysis.findUnique({
      where: { callSid: sid },
      select: {
        aiSummary: true,
        sentiment: true,
        recordingUrl: true,
      }
    });

    if (analysis) {
      successResponse(res, 200, "Call summary fetched successfully", analysis);
      return;
    }

    // 2. If no analysis, check the call record status to see if it's still "cooking"
    const callRecord = await prisma.callRecord.findUnique({
      where: { callSid: sid }
    });

    if (!callRecord) {
      errorResponse(res, { message: "Call record not found" }, 404);
      return;
    }

    // 3. Determine if it's truly missing or just taking time
    const isCompleted = callRecord.status === "completed";

    if (isCompleted && callRecord.endTime) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (new Date(callRecord.endTime) < fiveMinutesAgo) {
        successResponse(res, 200, "Call analysis is unavailable", { status: "unavailable" });
        return;
      }
    }

    // If not completed or completed recently, assume it's still processing
    successResponse(res, 200, "Call analysis is still processing", { status: "processing" });
    return;
  } catch (error: any) {
    console.error("Get call summary failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
};


// ── Dial Filters ─────────────────────────────────────────────────────────────

export const filterDialContacts: RequestHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) { errorResponse(res, { message: "Unauthorized" }, 401); return; }

    const { contactIds, listId, filters } = req.body as {
      contactIds: string[];
      listId?: string;
      filters: {
        startMode: 'resume' | 'top';
        neverDialed?: 'ever' | 'today' | '24h' | '2d' | '5d' | null;
        neverContacted?: boolean;
        statusChangedWithin?: '7d' | '14d' | '30d' | null;
        createdAfter?: string | null;
        createdBefore?: string | null;
      };
    };

    if (!contactIds?.length) {
      successResponse(res, 200, "No contacts provided", { contactIds: [] });
      return;
    }

    let result: string[] = [...contactIds];

    // Always exclude contacts already marked as CONTACTED — they've been successfully
    // reached and should never be re-queued regardless of which filter mode is used.
    const contactedContacts = await prisma.contact.findMany({
      where: { id: { in: result }, status: 'CONTACTED' },
      select: { id: true },
    });
    const contactedIdSet = new Set(contactedContacts.map((c: any) => c.id));
    result = result.filter((id) => !contactedIdSet.has(id));

    // Resolve to admin ID so filters cover the whole org (agents + admin share call history)
    const adminId = await resolveAdminId(userId);
    const orgUserIds = await prisma.user.findMany({
      where: { OR: [{ id: adminId }, { createdById: adminId }] },
      select: { id: true },
    }).then((rows: { id: string }[]) => rows.map((r) => r.id));

    // ── Never Dialed filter ────────────────────────────────────────────────
    if (filters.neverDialed) {
      let since: Date | undefined;
      const now = new Date();
      if (filters.neverDialed === 'today') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (filters.neverDialed === '24h') {
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (filters.neverDialed === '2d') {
        since = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      } else if (filters.neverDialed === '5d') {
        since = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      }
      // 'ever' means no call records at all → no `since` date

      const calledRecords = await prisma.callRecord.findMany({
        where: {
          contactId: { in: result },
          userId: { in: orgUserIds },
          ...(since ? { startTime: { gte: since } } : {}),
        },
        select: { contactId: true },
        distinct: ['contactId'],
      });
      const calledSet = new Set(calledRecords.map((r: any) => r.contactId).filter(Boolean));
      result = result.filter((id) => !calledSet.has(id));
    }

    // ── Never Contacted filter ─────────────────────────────────────────────
    if (filters.neverContacted) {
      // "Contacted" = call was actually answered (status: completed, not machine-detected).
      // Auto-dispositions like "No Answer" / "Busy" don't count — the agent never spoke
      // to the person, so those contacts should still appear in this filter.
      const contactedRecords = await prisma.callRecord.findMany({
        where: {
          contactId: { in: result },
          userId: { in: orgUserIds },
          status: 'completed',
          NOT: { disposition: { in: ['MACHINE', 'machine-detected'] } },
        },
        select: { contactId: true },
        distinct: ['contactId'],
      });
      const contactedSet = new Set(contactedRecords.map((r: any) => r.contactId).filter(Boolean));
      result = result.filter((id) => !contactedSet.has(id));
    }

    // ── Status Changed Within filter ───────────────────────────────────────
    if (filters.statusChangedWithin) {
      const days = filters.statusChangedWithin === '7d' ? 7 : filters.statusChangedWithin === '14d' ? 14 : 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const changedLogs = await prisma.contactDispositionLog.findMany({
        where: {
          contactId: { in: result },
          createdAt: { gte: since },
        },
        select: { contactId: true },
        distinct: ['contactId'],
      });
      const changedSet = new Set(changedLogs.map((l: any) => l.contactId));
      // Keep only contacts whose status DID change within the window
      result = result.filter((id) => changedSet.has(id));
    }

    // ── Created Date filter ────────────────────────────────────────────────
    if (filters.createdAfter || filters.createdBefore) {
      const contacts = await prisma.contact.findMany({
        where: {
          id: { in: result },
          ...(filters.createdAfter || filters.createdBefore ? {
            createdAt: {
              ...(filters.createdAfter ? { gte: new Date(filters.createdAfter) } : {}),
              ...(filters.createdBefore ? { lte: new Date(filters.createdBefore) } : {}),
            },
          } : {}),
        },
        select: { id: true },
      });
      const validSet = new Set(contacts.map((c: any) => c.id));
      result = result.filter((id) => validSet.has(id));
    }

    // ── Start Mode: Resume ─────────────────────────────────────────────────
    if (filters.startMode === 'resume' && listId) {
      const session = await (prisma as any).dialListSession.findUnique({
        where: { userId_listId: { userId, listId } },
      });

      if (session?.lastContactId && result.includes(session.lastContactId)) {
        const lastIdx = result.indexOf(session.lastContactId);
        // savedId means "start FROM here" — so slice is inclusive of lastIdx
        const afterLast = result.slice(lastIdx);
        const beforeLast = result.slice(0, lastIdx);

        // "New leads first" = contacts with no call records at all go to the front
        const anyCallRecords = await prisma.callRecord.findMany({
          where: { contactId: { in: result }, userId },
          select: { contactId: true },
          distinct: ['contactId'],
        });
        const everCalledSet = new Set(anyCallRecords.map((r: any) => r.contactId).filter(Boolean));

        const newLeads = beforeLast.filter((id) => !everCalledSet.has(id));
        const resumeFrom = afterLast;
        const remainder = beforeLast.filter((id) => everCalledSet.has(id));

        result = [...newLeads, ...resumeFrom, ...remainder];
      }
      // If no session found, use the order as-is (top of list)
    }

    successResponse(res, 200, "Contacts filtered successfully", { contactIds: result });
  } catch (error: any) {
    console.error("filterDialContacts failed:", error);
    errorResponse(res, { message: error.message });
  }
};

export const upsertDialSession: RequestHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) { errorResponse(res, { message: "Unauthorized" }, 401); return; }

    const { listId, lastContactId } = req.body as { listId: string; lastContactId: string };
    if (!listId || !lastContactId) {
      errorResponse(res, { message: "listId and lastContactId are required" }, 400);
      return;
    }

    await (prisma as any).dialListSession.upsert({
      where: { userId_listId: { userId, listId } },
      update: { lastContactId },
      create: { userId, listId, lastContactId },
    });

    successResponse(res, 200, "Dial session updated", {});
  } catch (error: any) {
    console.error("upsertDialSession failed:", error);
    errorResponse(res, { message: error.message });
  }
};

export const getDialSession: RequestHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) { errorResponse(res, { message: "Unauthorized" }, 401); return; }

    const { listId } = req.params;
    const session = await (prisma as any).dialListSession.findUnique({
      where: { userId_listId: { userId, listId } },
    });

    successResponse(res, 200, "Dial session fetched", { lastContactId: session?.lastContactId ?? null });
  } catch (error: any) {
    console.error("getDialSession failed:", error);
    errorResponse(res, { message: error.message });
  }
};

export const getContactAnalysis: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;
    if (!contactId) {
      errorResponse(res, { message: "Contact ID is required" }, 400);
      return;
    }

    // Get all completed call records for this contact that have analysis
    const callRecords = await prisma.callRecord.findMany({
      where: { contactId, status: "completed" },
      orderBy: { createdAt: "desc" },
    });

    if (callRecords.length === 0) {
      successResponse(res, 200, "No calls found for this contact", { hasData: false });
      return;
    }

    const callSids = callRecords.map((r: any) => r.callSid);

    const analyses = await prisma.callAnalysis.findMany({
      where: { callSid: { in: callSids } },
    });

    if (analyses.length === 0) {
      successResponse(res, 200, "No analysis available for this contact", { hasData: false });
      return;
    }

    // Aggregate sentiment counts
    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
    let totalConfidence = 0;

    for (const a of analyses) {
      const s = (a.sentiment || "").toLowerCase();
      if (s === "positive") sentimentCounts.positive++;
      else if (s === "negative") sentimentCounts.negative++;
      else sentimentCounts.neutral++;
      totalConfidence += a.confidence || 0;
    }

    const total = analyses.length;
    const positivePercent = Math.round((sentimentCounts.positive / total) * 100);
    const neutralPercent = Math.round((sentimentCounts.neutral / total) * 100);
    const negativePercent = 100 - positivePercent - neutralPercent;
    const avgConfidence = Math.round((totalConfidence / total) * 100);

    // Most recent call's data for suggestions
    const latestRecord = callRecords[0];
    const latestAnalysis = analyses.find((a: any) => a.callSid === latestRecord.callSid);

    successResponse(res, 200, "Contact analysis fetched successfully", {
      hasData: true,
      sentiment: {
        positive: positivePercent,
        neutral: neutralPercent,
        negative: negativePercent,
      },
      confidence: avgConfidence,
      totalCalls: total,
      latestDisposition: latestRecord.disposition || null,
      latestSentiment: latestAnalysis?.sentiment || null,
      latestSummary: latestAnalysis?.aiSummary || null,
    });
    return;
  } catch (error: any) {
    console.error("Get contact analysis failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
};

export const setCounter: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { sid } = req.params;
    const { from } = req.body;
    if (!sid) {
      errorResponse(res, { message: "Call SID is required" }, 400);
      return;
    }

    const callRecord = await prisma.callerId.update({
      where: { id: sid, twillioNumber: from },
      data: {
        counter: { increment: 1 },
      }
    });

    if (!callRecord) {
      errorResponse(res, { message: "Call record not found" }, 404);
      return;
    }

    successResponse(res, 200, "Call status fetched successfully", callRecord);
    return;
  } catch (error: any) {
    console.error("Get call status failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
};

export const getCallerIds: RequestHandler = async (req: Request, res: Response) => {
  try {
    const callerIds = await prisma.callerId.findMany({ where: { counter: { lt: 5 } } });
    successResponse(res, 200, "Caller IDs fetched successfully", callerIds);
    return;
  } catch (error: any) {
    console.error("Get caller IDs failed:", error);
    errorResponse(res, { message: error.message });
    return;
  }
};

export const toggleHold: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { callSid, hold, agentIdentity, customerCallSid, holdUrl } = req.body;
    if (!callSid) {
      errorResponse(res, { message: "Call SID is required" }, 400);
      return;
    }

    let customerLeg: any = null;

    // Find who owns this call to get the right client
    const callRecord = await prisma.callRecord.findFirst({
      where: { callSid }
    });

    // Fallback to memory if DB record not found (e.g. child leg)
    const metadata = (dialerService as any).activeCalls.get(callSid);
    const userId = callRecord?.userId || metadata?.userId;
    const userClient = userId ? await getTwilioClient(userId) : client;

    // 1. Try explicitly provided customer call SID
    if (customerCallSid) {
      try {
        const potentialLeg = await userClient.calls(customerCallSid).fetch();
        // 🚨 Relaxed status check: Included 'answered' and 'queued'
        const validStatuses = ['in-progress', 'ringing', 'answered', 'queued'];
        if (potentialLeg && validStatuses.includes(potentialLeg.status)) {
          customerLeg = potentialLeg;
        }
      } catch (err) {
        console.warn("Provided customerCallSid not found or invalid:", err);
      }
    }

    // 2. Fallback: Deduce customer leg from active callSid
    if (!customerLeg) {
      try {
        const currentCall = await userClient.calls(callSid).fetch();

        // Case A: The agent's call is a child of the customer's call (After Resume)
        if (currentCall.parentCallSid) {
          customerLeg = await userClient.calls(currentCall.parentCallSid).fetch();
        }
        // Case B: The agent's call is the parent of the customer's call (Outbound initial)
        else {
          const childCalls = await userClient.calls.list({ parentCallSid: callSid });
          customerLeg = childCalls.find(c => ['in-progress', 'ringing', 'answered'].includes(c.status));
        }

        // Case C: Fallback, the callSid itself IS the customer leg
        if (!customerLeg && !currentCall.to?.startsWith('client:') && !currentCall.from?.startsWith('client:')) {
          customerLeg = currentCall;
        }
      } catch (fallbackErr) {
        console.warn("Fallback tree lookup failed (Call might be fully dropped):", fallbackErr);
      }
    }

    if (!customerLeg) {
      errorResponse(res, { message: "Customer leg not found. Call may have disconnected." }, 404);
      return;
    }

    const defaultHoldMusic = "https://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3";
    const musicUrl = holdUrl || defaultHoldMusic;

    if (hold) {
      // Play hold music to customer
      await userClient.calls(customerLeg.sid).update({
        twiml: `<Response><Play loop="0">${musicUrl}</Play></Response>`
      });
    } else {
      // Reconnect customer to agent
      const twiml = `<Response>
        <Say>Reconnecting you now.</Say>
        <Dial record="record-from-answer-dual" recordingStatusCallback="${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status">
          <Client>${agentIdentity}</Client>
        </Dial>
        <Hangup/>
      </Response>`;

      await userClient.calls(customerLeg.sid).update({ twiml });
    }

    // Pause/resume recording safely
    try {
      const recordingCallSid = customerLeg.parentCallSid ? customerLeg.parentCallSid : customerLeg.sid;
      const recordings = await userClient.calls(recordingCallSid).recordings.list();
      for (const recording of recordings) {
        if (hold && recording.status === 'in-progress') {
          await userClient.calls(recordingCallSid).recordings(recording.sid).update({ status: 'paused' });
        } else if (!hold && recording.status === 'paused') {
          await userClient.calls(recordingCallSid).recordings(recording.sid).update({ status: 'in-progress' });
        }
      }
    } catch (recErr) {
      console.warn("Recording toggle failed (non-fatal):", recErr);
    }

    successResponse(res, 200, hold ? "Customer on hold" : "Customer resumed", { customerLegSid: customerLeg.sid });
  } catch (error: any) {
    console.error("Toggle hold failed:", error);
    errorResponse(res, { message: error.message });
  }
};

// SMS Inbox & Webhooks
export const handleIncomingSms: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { From, To, Body, MessageSid } = req.body;
    console.log(`[SMS Webhook] START - From: ${From}, To: ${To}, Body: ${Body}, SID: ${MessageSid}`);

    if (!From || !To || !Body) {
      console.warn("[SMS Webhook] Missing required fields in Twilio request body:", req.body);
      res.sendStatus(400);
      return;
    }

    // Normalize phone number for lookup
    const digits = From.replace(/\D/g, "");
    const searchNumber = digits.length > 10 ? digits.slice(-10) : digits;
    console.log(`[SMS Webhook] Normalized sender number: ${searchNumber}`);

    // 1. Find the agent (User) who owns the 'To' number (This is the primary way to route)
    const callerId = await prisma.callerId.findFirst({
      where: { twillioNumber: To },
      include: { systemSetting: true }
    });
    let userId = callerId?.systemSetting.userId;

    // 2. Find matching contacts
    const matchingContactPhones = await prisma.contactPhone.findMany({
      where: { number: { contains: searchNumber } },
      include: { contact: true }
    });

    let finalContact = null;

    if (matchingContactPhones.length > 0) {
      if (matchingContactPhones.length === 1) {
        finalContact = matchingContactPhones[0].contact;
      } else {
        // DUPLICATE DETECTED: Pick the one with the most recent SMS activity with THIS user
        console.log(`[SMS Webhook] ${matchingContactPhones.length} contacts found for ${searchNumber}. Finding active one...`);

        const contactIds = matchingContactPhones.map(cp => cp.contactId);
        const lastActivity = await prisma.smsLog.findFirst({
          where: {
            userId,
            contactId: { in: contactIds }
          },
          orderBy: { createdAt: 'desc' },
          select: { contactId: true }
        });

        if (lastActivity) {
          finalContact = matchingContactPhones.find(cp => cp.contactId === lastActivity.contactId)?.contact;
          console.log(`[SMS Webhook] Prioritized contact based on activity: ${finalContact?.fullName}`);
        } else {
          finalContact = matchingContactPhones[0].contact; // Fallback to first
        }
      }
    }

    // Fallback: If userId wasn't found from Twilio number, try contact's owner
    if (!userId && finalContact) {
      userId = finalContact.userId ?? undefined;
    }

    if (userId) {
      console.log(`[SMS Webhook] Associated message with User ID: ${userId}, Contact: ${finalContact?.fullName || 'Unknown'}`);
      await prisma.smsLog.create({
        data: {
          to: To,
          from: From,
          content: Body,
          status: "RECEIVED",
          messageSid: MessageSid,
          userId,
          contactId: finalContact?.id
        }
      });
      console.log(`[SMS Webhook] SUCCESS - Log entry created.`);
    } else {
      console.warn(`[SMS Webhook] FAILED - Could not determine owner (User ID) for message to ${To}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("[SMS Webhook] CRITICAL ERROR:", error);
    res.sendStatus(500);
  }
};

export const getSmsInbox: RequestHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    // 1. Fetch all contacts for this user
    const allContacts = await prisma.contact.findMany({
      where: { userId },
      include: { phones: true }
    });

    // Map each phone number to its "Best" contact
    const phoneToBestContactMap = new Map();
    for (const contact of allContacts) {
      for (const p of contact.phones) {
        const digits = p.number.replace(/\D/g, "");
        const norm = digits.length > 10 ? digits.slice(-10) : digits;

        // If multiple contacts have the same number, we prioritize the one with a longer name or just the first one
        // (This is just for mapping; the canonical logic below is more important)
        if (!phoneToBestContactMap.has(norm)) {
          phoneToBestContactMap.set(norm, contact);
        }
      }
    }

    // 2. Fetch all logs
    const allLogs = await prisma.smsLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    // 3. Group logs into unique threads by Phone Number
    const threadMap = new Map();

    for (const log of allLogs) {
      const remoteNumber = log.status === 'RECEIVED' ? log.from : log.to;
      const digits = remoteNumber.replace(/\D/g, "");
      const norm = digits.length > 10 ? digits.slice(-10) : digits;

      // Group by the normalized phone number to ensure NO duplicates in sidebar
      if (!threadMap.has(norm)) {
        // Find ALL contacts that share this number
        const matchingContacts = allContacts.filter(c =>
          c.phones.some(p => {
            const d = p.number.replace(/\D/g, "");
            const n = d.length > 10 ? d.slice(-10) : d;
            return n === norm;
          })
        );

        let bestContact = null;
        if (matchingContacts.length > 0) {
          // PRIORITY: 
          // 1. The contact from the most recent SENT message for this number (The one the agent intended)
          const lastSentLog = allLogs.find(l =>
            l.status === 'SENT' &&
            (l.to.replace(/\D/g, "").slice(-10) === norm || l.to.replace(/\D/g, "") === norm) &&
            matchingContacts.some(c => c.id === l.contactId)
          );

          if (lastSentLog) {
            bestContact = matchingContacts.find(c => c.id === lastSentLog.contactId);
          }

          // 2. Fallback to the contact from the current log
          if (!bestContact) {
            bestContact = matchingContacts.find(c => c.id === log.contactId);
          }

          // 3. Fallback to first matching contact
          if (!bestContact) {
            bestContact = matchingContacts[0];
          }
        }

        threadMap.set(norm, {
          lastLog: log,
          contact: bestContact || null,
          remoteNumber: remoteNumber,
          isUnknown: !bestContact
        });
      }
    }

    // 4. Final step: If multiple phone numbers belong to the SAME contact, 
    // we should ideally unify those into one thread too.
    const contactThreads = new Map();
    const finalInbox: any[] = [];

    for (const [norm, thread] of threadMap.entries()) {
      if (thread.contact) {
        const existing = contactThreads.get(thread.contact.id);
        if (existing) {
          // If this number's log is newer than the existing thread's log, update it
          if (thread.lastLog.createdAt > existing.smsLogs[0].createdAt) {
            existing.smsLogs = [thread.lastLog];
            existing.remoteNumber = thread.remoteNumber;
          }
        } else {
          const newThread = {
            id: thread.contact.id,
            fullName: thread.contact.fullName,
            isUnknown: false,
            remoteNumber: thread.remoteNumber,
            contact: thread.contact,
            smsLogs: [thread.lastLog],
            phones: thread.contact.phones
          };
          contactThreads.set(thread.contact.id, newThread);
          finalInbox.push(newThread);
        }
      } else {
        finalInbox.push({
          id: norm,
          fullName: thread.remoteNumber,
          isUnknown: true,
          remoteNumber: thread.remoteNumber,
          contact: null,
          smsLogs: [thread.lastLog],
          phones: [{ number: thread.remoteNumber }]
        });
      }
    }

    // Sort by last message date
    finalInbox.sort((a, b) => {
      const dateA = new Date(a.smsLogs[0].createdAt).getTime();
      const dateB = new Date(b.smsLogs[0].createdAt).getTime();
      return dateB - dateA;
    });

    successResponse(res, 200, "Inbox fetched successfully", finalInbox);
  } catch (error: any) {
    errorResponse(res, { message: error.message });
  }
};

export const getSmsConversation: RequestHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { contactId } = req.params;

    const isPhoneNumber = /^\+?[0-9]+$/.test(contactId);
    let searchNumbers: string[] = [];

    if (isPhoneNumber) {
      const digits = contactId.replace(/\D/g, "");
      searchNumbers = [digits.length > 10 ? digits.slice(-10) : digits];
    } else {
      // Find the contact and all their numbers
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { phones: true }
      });
      if (contact) {
        searchNumbers = contact.phones.map(p => {
          const digits = p.number.replace(/\D/g, "");
          return digits.length > 10 ? digits.slice(-10) : digits;
        });
      }
    }

    const messages = await prisma.smsLog.findMany({
      where: {
        userId,
        OR: [
          { contactId: isPhoneNumber ? undefined : contactId },
          ...searchNumbers.map(num => ({
            OR: [
              { from: { contains: num } },
              { to: { contains: num } }
            ]
          }))
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    // Final filtering to ensure we only get messages for the specific user and contact context
    // (Prevents broad 'contains' from matching wrong numbers if searchNumbers was too short)
    const filteredMessages = messages.filter(msg => {
      const remote = msg.status === 'RECEIVED' ? msg.from : msg.to;
      const remoteDigits = remote.replace(/\D/g, "");
      const remoteNorm = remoteDigits.length > 10 ? remoteDigits.slice(-10) : remoteDigits;
      return searchNumbers.includes(remoteNorm) || msg.contactId === contactId;
    });

    successResponse(res, 200, "Conversation fetched successfully", filteredMessages);
  } catch (error: any) {
    errorResponse(res, { message: error.message });
  }
};
