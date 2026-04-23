import { errorResponse, successResponse } from "@/utils/handler";
import { client } from "@/lib/config";
import { Request, Response, RequestHandler } from "express";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { dialerService } from "./services";
import prisma from "@/lib/prisma";
import { envConfig } from "@/lib/config";
import twilio from "twilio";
import { insertCallerIdInDb } from "../systemSettings/callerId/service";

const { jwt: { AccessToken } } = twilio;
const VoiceGrant = AccessToken.VoiceGrant;

const fromNumber = envConfig.TWILIO_PHONE_NUMBER as string;
export const startCalling: RequestHandler = async (req, res) => {
  const agentId = req.params.agentId;
  try {
    const { to, contactId } = req.body;
    if (!to) {
      errorResponse(res, { message: "Phone number is required" }, 400);
      return;
    }
    const call = await client.calls.create({
      to: to, // Lead Number (here the number is dynamic for now on testing account i've only 1 verified caller ID)
      url: `${envConfig.BACKEND_URL}/api/calling/webhooks/voice?agentId=${agentId}`,
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      from: fromNumber,
      // applicationSid:"APd8c43edcdeb39fb09d7d904eeec31271",    
      timeout: 30,
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
    const currentCall = await client.calls(callSid).fetch();
    const targetSid = currentCall.parentCallSid || callSid;

    console.log(`Resolved termination target: ${targetSid} (Original: ${callSid})`);
    const call = await client.calls(targetSid).update({ status: 'completed' });

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
    dialerService.clearQueue(userId);
    console.log(`[stopDialing] Queue cleared and lock released for user ${userId}`);
    successResponse(res, 200, "Simultaneous dialing queue stopped", null);
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
    const { leads, callerId, callerIds, pacing }: { leads: any[], callerId?: string, callerIds?: string | string[], pacing?: number } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
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

    const savedLeads = await Promise.all(
      leads.map(async (l) => {
        const existing = existingPhonesMap.get(l.phone);
        if (existing) {
          // Update existing lead to PENDING
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
        } else {
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
        }
      })
    );

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
    const phoneToContactId = new Map(leads.map((l: any) => [l.phone, l.id]));
    await dialerService.addLeadsToQueue(
      userId,
      savedLeads.map((l) => ({
        id: l.id,
        fullName: l.fullName,
        phone: l.phone,
        priority: l.priority,
        userId: userId,
        originalContactId: phoneToContactId.get(l.phone),
      })),
      callerIds || callerId, // Pass selected caller IDs (array) or ID (string) to service
      pacing              // Pass session-level pacing override
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
  const answeringMachineUrl = body.answeringMachineUrl || req.query.answeringMachineUrl || "";
  const busyRecordingUrl = body.busyRecordingUrl || req.query.busyRecordingUrl || "";

  if ((!agentId || agentId === 'undefined' || agentId === 'null') && isBrowserOrigin) {
    agentId = browserIdentity.split(':')[1];
    console.log(`[VoiceWebhook] Extracted agentId ${agentId} from caller identity.`);
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
        sessionId: null,
        isBrowserCall: true,
        status: "initiated"
      });

      await prisma.callRecord.create({
        data: {
          callSid: body.CallSid,
          userId: agentId,
          contactId: contactId,
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
      callerId: envConfig.TWILIO_PHONE_NUMBER,
      record: "record-from-answer-dual",
      recordingStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status`,
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

    if (!agentId || agentId === 'undefined' || agentId === 'null') {
      console.error("[VoiceWebhook] Missing or invalid agentId for bridge request.");
      twiml.say("We are unable to connect you to an agent right now.");
      twiml.hangup();
      res.type("text/xml");
      res.send(twiml.toString());
      return;
    }

    const isBusyBoolean = dialerService.isAgentBusy(agentId);
    const activeLockOwner = (dialerService as any).agentBridgedCallId.get(agentId);
    const isLockOwnerStale = activeLockOwner && !(dialerService as any).activeCalls.has(activeLockOwner);

    const isActuallyBusy = isBusyBoolean && activeLockOwner && activeLockOwner !== currentCallSid && !isLockOwnerStale;

    if (isActuallyBusy) {
      console.log(`[VoiceWebhook] Agent ${agentId} is busy (locked by ${activeLockOwner}). Putting ${currentCallSid} on hold.`);

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

      // Schedule automatic redial once hold audio finishes
      if (contactId) {
        dialerService.requeueLeadForRedial(agentId, contactId, 5_000);
      }

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
      sessionId: existingMeta?.sessionId || null,
      isBrowserCall: false,
      status: "in-progress"
    });

    // bridgeCallerId must be a verified Twilio number so the agent browser leg is accepted.
    // body.From  = the Twilio number we used to dial the customer (e.g. +18782061927) ✅
    // body.To    = the customer's PSTN number (e.g. +923152557056)                   ❌
    // Prefer the explicit env var; fall back to body.From which is always a Twilio number.
    const bridgeCallerId = envConfig.TWILIO_PHONE_NUMBER || body.From;

    const dial = twiml.dial({
      callerId: bridgeCallerId,
      answerOnBridge: true, // Customer is answered now, bridge to agent
      record: "record-from-answer-dual",
      recordingStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status`,
    });

    const clientNode = dial.client({
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status?agentId=${agentId}`,
      statusCallbackMethod: "POST",
    }, agentId);

    if (contactId) {
      clientNode.parameter({ name: 'contactId', value: contactId });
    }
  }

  res.type("text/xml");
  res.send(twiml.toString());
  return;
};


// For answering machine. WEbhoook
export const handleAmdStatus: RequestHandler = async (req, res) => {
  try {
    const { CallSid, AnsweredBy } = req.body;
    const answeringMachineUrl = req.query.answeringMachineUrl as string;
    const agentId = req.query.agentId as string;

    console.log(`[AMD] Call ${CallSid} answered by: ${AnsweredBy}`);

    // AnsweredBy values: 'human', 'machine_start', 'machine_end_beep', 
    //                    'machine_end_silence', 'machine_end_other', 'fax', 'unknown'
    const isMachine = AnsweredBy?.startsWith('machine') || AnsweredBy === 'fax';

    if (isMachine) {
      console.log(`[AMD] Machine detected for ${CallSid}.`);

      try {
        await (prisma.callRecord as any).update({
          where: { callSid: CallSid },
          data: { disposition: "MACHINE", status: "machine-detected" }
        });
      } catch (e) { }

      if (answeringMachineUrl) {
        console.log(`[AMD] Dropping out-of-band voicemail for ${CallSid}`);
        await client.calls(CallSid).update({
          twiml: `<Response>
                      <Play>${answeringMachineUrl}</Play>
                      <Hangup/>
                  </Response>`
        });
      } else {
        console.log(`[AMD] No voicemail configured. Hanging up ${CallSid}`);
        await client.calls(CallSid).update({ status: 'completed' });
      }
    } else {
      console.log(`[AMD] ${isMachine ? 'Machine' : 'Human'} answered ${CallSid}`);
    }

    res.sendStatus(200);
    return;
  } catch (error: any) {
    console.error('[AMD] Status handling failed:', error);
    res.sendStatus(200); // Always 200 to Twilio
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
    const currentCall = await client.calls(callSid).fetch();
    const childCalls = await client.calls.list({ parentCallSid: callSid });
    const customerLeg = childCalls.find(c =>
      ['in-progress', 'ringing', 'answered'].includes(c.status)
    ) || currentCall;

    // Play voicemail to customer and hang up
    await client.calls(customerLeg.sid).update({
      twiml: `<Response>
                <Play>${voicemailUrl}</Play>
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
    console.log(`Recording ready for Call ${CallSid}: ${RecordingUrl} (${RecordingStatus})`);
    if (RecordingStatus === 'completed') {
      await dialerService.handleRecordingUpdate(CallSid, RecordingUrl, RecordingSid);
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
    const { CallSid, CallStatus, ParentCallSid } = req.body;
    const agentId = req.query.agentId as string;

    console.log(
      `Call ${CallSid} status update: ${CallStatus}` +
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
        CallStatus,
        true,
        agentId
      );
    }

    // Optional: handle standalone calls (no parent)
    if (!ParentCallSid) {
      await dialerService.handleCallStatusUpdate(
        CallSid,
        CallStatus,
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
    const { countryCode, cityName, state } = req.body;

    console.log("countryCode", countryCode);
    console.log("cityName", cityName);
    console.log("state", state);

    const numbers = await client.availablePhoneNumbers(countryCode || "US").local.list({
      limit: 10,
      inLocality: cityName,
      inRegion: state,
    });

    const pricing = await client.pricing.v1
      .phoneNumbers
      .countries(countryCode)
      .fetch();

    if (!numbers) {
      errorResponse(res, { message: "No numbers found" });
      return;
    }


    const data = {
      numbers,
      pricing
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
    const { phoneNumber, countryCode, label } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
    }

    const number = await client.incomingPhoneNumbers.create({
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
 * Access Token: Generate token for Browser-based Agent
 */
export const getTwilioToken: RequestHandler = async (req, res) => {
  try {
    const accountSid = envConfig.TWILIO_ACCOUNT_SID!;
    const apiKey = envConfig.TWILIO_API_KEY;
    const apiSecret = envConfig.TWILIO_API_SECRET;

    // Use the authenticated user's ID as identity
    const identity = req.user?.id || (req.query.identity as string) || 'tester_agent';

    if (!apiKey || !apiSecret) {
      console.warn("TWILIO_API_KEY or TWILIO_API_SECRET missing in .env.");
    }

    const token = new AccessToken(
      accountSid,
      apiKey || '',
      apiSecret || '',
      { identity: identity }
    );

    // Use the Twiml App SID from the environment to ensure tokens authorize for the current account
    const twimlAppSid = envConfig.TWILIO_TWIML_APP_SID || "AP2dfe20dda942797074ca416be8142b9c";

    const grant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    });
    token.addGrant(grant);

    successResponse(res, 200, "Token generated successfully", {
      identity: identity,
      token: token.toJwt(),
      completeToken: token
    });
  } catch (error: any) {
    console.error("Token generation failed:", error);
    errorResponse(res, { message: "Failed to generate token." });
  }
}


export const sendSms: RequestHandler = async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { to, message, from } = req.body;
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
    const twilioStart = Date.now();
    const service = await client.messages.create({
      body: message,
      from: senderNumber,
      to: formattedTo,
      // Optional: Add status callback for background tracking without blocking the agent
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/sms-status`,
    });
    const twilioEnd = Date.now();

    console.log(`[sendSms] Twilio API Response: SID=${service.sid}, Time=${twilioEnd - twilioStart}ms`);
    
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
    const insights = await client.calls.list({ status: "completed", limit: 10 });
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
    const insights = await client.intelligence.v2.transcripts.create({
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

    if (!callRecord) {
      errorResponse(res, { message: "Call record not found" }, 404);
      return;
    }

    successResponse(res, 200, "Call status fetched successfully", {
      status: callRecord.status,
      disposition: callRecord.disposition
    });
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

    // 1. Try explicitly provided customer call SID
    if (customerCallSid) {
      try {
        const potentialLeg = await client.calls(customerCallSid).fetch();
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
        const currentCall = await client.calls(callSid).fetch();

        // Case A: The agent's call is a child of the customer's call (After Resume)
        if (currentCall.parentCallSid) {
          customerLeg = await client.calls(currentCall.parentCallSid).fetch();
        }
        // Case B: The agent's call is the parent of the customer's call (Outbound initial)
        else {
          const childCalls = await client.calls.list({ parentCallSid: callSid });
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
      await client.calls(customerLeg.sid).update({
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

      await client.calls(customerLeg.sid).update({ twiml });
    }

    // Pause/resume recording safely
    try {
      const recordingCallSid = customerLeg.parentCallSid ? customerLeg.parentCallSid : customerLeg.sid;
      const recordings = await client.calls(recordingCallSid).recordings.list();
      for (const recording of recordings) {
        if (hold && recording.status === 'in-progress') {
          await client.calls(recordingCallSid).recordings(recording.sid).update({ status: 'paused' });
        } else if (!hold && recording.status === 'paused') {
          await client.calls(recordingCallSid).recordings(recording.sid).update({ status: 'in-progress' });
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
