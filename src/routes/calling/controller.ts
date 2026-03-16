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
            sessionId: null
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

    console.log("Terminating call:", callSid);
    const call = await client.calls(callSid).update({ status: 'completed' });

    successResponse(res, 200, "Call terminated successfully", call);
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

/**
 * Bulk add leads to the database and priority queue
 */
export const addLeadsToDialer: RequestHandler = async (req, res) => {
  try {
    const { leads }: { leads: any[] } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      errorResponse(res, { message: "Unauthorized. Please log in." }, 401);
      return;
    }

    if (!leads || !Array.isArray(leads)) {
      errorResponse(res, { message: "Invalid leads format. Expected an array." }, 400);
      return;
    }

    // 1. Separate leads into those that exist and those that don't
    const phones = leads.map((l) => l.phone);
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

    // 2. Add to Dialer Queue
    await dialerService.addLeadsToQueue(
      userId,
      savedLeads.map((l) => ({
        id: l.id,
        fullName: l.fullName,
        phone: l.phone,
        priority: l.priority,
        userId: userId,
      }))
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
  const from = body.From || req.query.From;
  const caller = body.Caller || req.query.Caller || "";
  const agentId = body.agentId || req.query.agentId || req.params.agentId;
  const contactId = body.contactId || req.query.contactId || req.params.contactId;


  console.log("================= Voice Webhook Dispatcher ================");
  console.log("Caller:", caller);
  console.log("To:", to);
  console.log("From:", from);
  console.log("AgentId:", agentId);
  console.log("ContactId:", contactId);

  // PERSISTENCE: Create CallRecord for browser-initiated calls if not present
  if (caller.startsWith("client:") && agentId) {
    try {
      // Register with dialerService for status tracking
      (dialerService as any).activeCalls.set(body.CallSid, {
        userId: agentId,
        sessionId: null,
        isBrowserCall: true
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

  // Start Real-time Transcription
  const start = twiml.start();
  start.transcription({
    track: "both_tracks",
    statusCallbackUrl: `${envConfig.BACKEND_URL}/api/calling/webhooks/transcription`,
  });

  // CASE A: Call initiated FROM the Browser SDK (TwiML App flow)
  // In this case, 'Caller' starts with 'client:'
  if (caller.startsWith("client:")) {
    console.log("[VoiceWebhook] Browser-to-PSTN Call detected");
    twiml.say("Please wait while we are connecting your call.");
    const dial = twiml.dial({
      callerId: from, // This is the Twilio number assigned to the app/device
      record: "record-from-answer-dual",
      recordingStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status`,
    });
    dial.number({
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status`,
      statusCallbackMethod: "POST",
    }, to); // Dial the actual phone number
  }

  // CASE B: Bridged Call or Inbound (Server-side startCalling or Direct Inbound)
  // We want to dial the Agent in the browser.
  else {
    console.log("[VoiceWebhook] PSTN-to-Browser (Bridge) Call detected");
    twiml.say("Please wait while we connect you to an agent.");
    const dial = twiml.dial({
      callerId: from, // Keep the original caller ID
      record: "record-from-answer-dual",
      recordingStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/recording-status`,
    });

    // Bridge to the specific agent identity
    dial.client(agentId);
  }

  res.type("text/xml");
  res.send(twiml.toString());
  return;
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

    console.log(
      `Call ${CallSid} status update: ${CallStatus}` +
      (ParentCallSid ? ` (Parent: ${ParentCallSid})` : '')
    );

    // 🔥 ONLY propagate CHILD leg updates to parent
    if (ParentCallSid) {
      await dialerService.handleCallStatusUpdate(
        ParentCallSid,
        CallStatus,
        true
      );
    }

    // Optional: handle standalone calls (no parent)
    if (!ParentCallSid) {
      await dialerService.handleCallStatusUpdate(
        CallSid,
        CallStatus,
        false
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

    const grant = new VoiceGrant({
      outgoingApplicationSid: "AP2dfe20dda942797074ca416be8142b9c",
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
  try {
    const { to, message } = req.body;
    if (!to || !message) {
      errorResponse(res, { message: "Recipient number (to) and message are required" }, 400);
      return;
    }

    const service = await client.messages.create({
      body: message,
      from: fromNumber,
      to: to,
    });

    console.log(service.sid);
    successResponse(res, 200, "SMS sent successfully", service);
    return;
  } catch (error: any) {
    console.error("Number buy failed:", error);
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

    successResponse(res, 200, "Call status fetched successfully", { status: callRecord.status });
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
        const validStatuses =['in-progress', 'ringing', 'answered', 'queued'];
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
        <Play loop="0">${musicUrl}</Play>
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
