import { errorResponse, successResponse } from "../../utils/handler";
import { client } from "../../lib/config";
import { Request, Response, RequestHandler } from "express";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { dialerService } from "./services";
import prisma from "../../lib/prisma";

const fromNumber = process.env.TWILIO_PHONE_NUMBER as string;
export const startCalling: RequestHandler = async (req, res) => {
 try {
    const { to } = req.body;
    if (!to) {
      errorResponse(res, { message: "Phone number is required" }, 400);
      return;
    }
    const call = await client.calls.create({
      to: to, // Lead Number (here the number is dynamic for now on testing account i've only 1 verified caller ID)
      url: `${process.env.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/voice`, // This will now bridge to Agent
      statusCallback: `${process.env.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/call-status`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      from: fromNumber,
      timeout: 30,
    });

    console.log("Single Test Call SID:", call.sid);
    successResponse(res, 200, "Single test call lagi!", call);
    return;
  } catch (error: any) {
    console.error("Single call failed:", error);
    errorResponse(res, {message: error.message});
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
  const agentNumber = process.env.AGENT_PHONE_NUMBER || '+923413227282'; // Fallback to provided number
  
  // Start Real-time Transcription
  const start = twiml.start();
  start.transcription({
    track: 'both_tracks',
    statusCallbackUrl: `${process.env.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/transcription`,
  });

  twiml.say('Please wait while we connect you to an agent.');
  
  const dial = twiml.dial({
    record: 'record-from-answer-dual', // Records both channels
    recordingStatusCallback: `${process.env.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/recording-status`,
  });
  
  // Bridge to the real agent phone number
  dial.number(agentNumber);

  res.type('text/xml');
  res.send(twiml.toString());
  return;
};

/**
 * RecordingStatus Webhook: Triggered when recording is ready
 */
export const handleRecordingStatus: RequestHandler = async (req, res) => {
  try {
    const { CallSid, RecordingUrl, RecordingStatus } = req.body;
    console.log(`Recording ready for Call ${CallSid}: ${RecordingUrl} (${RecordingStatus})`);

    if (RecordingStatus === 'completed') {
      await dialerService.handleRecordingUpdate(CallSid, RecordingUrl);
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
    const { CallSid, TranscriptionData } = req.body;
    
    // Twilio sends TranscriptionData as a JSON string or object
    const data = typeof TranscriptionData === 'string' ? JSON.parse(TranscriptionData) : TranscriptionData;
    
    if (data && data.transcript) {
      const speaker = data.track === 'inbound' ? 'Customer' : 'Agent';
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


export const sendSms: RequestHandler = async (req: Request, res: Response) => {
  try {
    const {message} = req.body
    const service =  await client.messages.create({
    body: message,
    from: fromNumber,
    to: "+923413227282",
  });

  console.log(service.sid);
  successResponse(res, 200, "Number bought successfully", service);
  return;
  } catch (error: any) {
    console.error("Number buy failed:", error);
    errorResponse(res, {message: error.message});
    return;
  }
}