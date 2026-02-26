import { errorResponse, successResponse } from "@/utils/handler";
import { client } from "@/lib/config";
import { Request, Response, RequestHandler } from "express";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { dialerService } from "./services";
import prisma from "@/lib/prisma";
import { envConfig } from "@/lib/config";
import twilio from "twilio";

const { jwt: { AccessToken } } = twilio;
const VoiceGrant = AccessToken.VoiceGrant;

const fromNumber = envConfig.TWILIO_PHONE_NUMBER as string;
export const startCalling: RequestHandler = async (req, res) => {
  console.log(`[startCalling] ENTERED - Body: ${JSON.stringify(req.body)}`);
  try {
    const { to, contactId } = req.body;
    if (!to) {
      errorResponse(res, { message: "Phone number is required" }, 400);
      return;
    }
    const call = await client.calls.create({
      to: to, // Lead Number (here the number is dynamic for now on testing account i've only 1 verified caller ID)
      url: `${envConfig.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/voice`, // This will now bridge to Agent
      statusCallback: `${envConfig.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/call-status`,
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
    errorResponse(res, {message: error.message});
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
  
  // Start Real-time Transcription
  const start = twiml.start();
  start.transcription({
    track: 'both_tracks',
    statusCallbackUrl: `${envConfig.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/transcription`,
  });

  twiml.say('Please wait while we connect you to an agent.');
  
  const dial = twiml.dial({
    record: 'record-from-answer-dual', // Records both channels
    recordingStatusCallback: `${envConfig.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/recording-status`,
  });
  
  // Bridge to the browser-based tester agent
  dial.client('tester_agent');

  res.type('text/xml');
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
    errorResponse(res, {message: error.message});
    return;
  }
}

/**
 * Transcription Webhook: Triggered for each transcription fragment
 */
export const handleTranscriptionWebhook: RequestHandler = async (req, res) => {
  try {
    const { CallSid, TranscriptionData, Track } = req.body;
    console.log("[TranscriptionDataJSON]  ",JSON.stringify(TranscriptionData))
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
    const { CallSid, CallStatus } = req.body;
    console.log(`Call ${CallSid} status update: ${CallStatus}`);

    // Update DB and Memory Queue
    await dialerService.handleCallStatusUpdate(CallSid, CallStatus);

    successResponse(res, 200, "Call status updated", req.body);
    return;
  } catch (error: any) {
    errorResponse(res, {message: error.message});
    return;
  }
}

export const voiceCall: RequestHandler = async (req, res) => {
    const twiml = new VoiceResponse();
    twiml.say('Hello from the multi-dialer! Integration successful.');
    res.type('text/xml');
    res.send(twiml.toString());
    return;
}

export const getAvailableUsNumbers: RequestHandler = async (req, res) => {
  try {
    const numbers = await client.availablePhoneNumbers("US").local.list({
      limit: 10
    });
    successResponse(res, 200, "Available numbers fetched successfully", numbers);
    return;
  } catch (error: any) {
    console.error("Available numbers fetch failed:", error);
    errorResponse(res, {message: error.message});
    return;
  }
}

export const buyNumber: RequestHandler = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const number = await client.incomingPhoneNumbers.create({
      phoneNumber: phoneNumber,
    });
    successResponse(res, 200, "Number bought successfully", number);
    return;
  } catch (error: any) {
    console.error("Number buy failed:", error);
    errorResponse(res, {message: error.message});
    return;
  }
}

/**
 * Access Token: Generate token for Browser-based Agent
 */
export const getTwilioToken: RequestHandler = async (req, res) => {
  try {
    const accountSid = envConfig.TWILIO_ACCOUNT_SID!;
    // Note: Trial accounts can typically use AuthToken for simple tokens if needed, 
    // but standard approach uses API Key. For this project, we'll try to generate a basic token.
    const apiKey = envConfig.TWILIO_API_KEY;
    const apiSecret = envConfig.TWILIO_API_SECRET;
    if (!apiKey || !apiSecret) {
      // Fallback for user: Tell them they need to add these to .env if standard token fails
      console.warn("TWILIO_API_KEY or TWILIO_API_SECRET missing in .env. Use Twilio Console to create them.");
    }

    const identity = 'tester_agent';
    const token = new AccessToken(
      accountSid,
      apiKey || '', // If missing, the SDK will error, prompting the user to add them
      apiSecret || '',
      { identity: identity }
    );

    const grant = new VoiceGrant({
      incomingAllow: true, // Allow receiving bridged calls
    });
    token.addGrant(grant);

    successResponse(res, 200, "Token generated successfully", {
      identity: identity,
      token: token.toJwt(),
    });
  } catch (error: any) {
    console.error("Token generation failed:", error);
    errorResponse(res, { message: "Failed to generate token. Ensure TWILIO_API_KEY and TWILIO_API_SECRET are set." });
  }
}


export const sendSms: RequestHandler = async (req: Request, res: Response) => {
  try {
    const {message} = req.body
    const service =  await client.messages.create({
    body: message,
    from: fromNumber,
    to: "+923413227282",
  });

  console.log(service.sid);
  successResponse(res, 200, "SMS sent successfully", service);
  return;
  } catch (error: any) {
    console.error("Number buy failed:", error);
    errorResponse(res, {message: error.message});
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
    const {RecordingSid} = req.body;
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
    const calls = await client.calls.list({ limit: 20 });
    const history = calls.map(call => call.toJSON());
    successResponse(res, 200, "Calls history fetched successfully", history);
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