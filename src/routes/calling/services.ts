import { client } from "@/lib/config";
import prisma from "@/lib/prisma";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import { cloudinaryUploader } from "@/utils/handler";
import { envConfig } from "@/lib/config";
import Groq from "groq-sdk";


enum LeadCallStatus {
  PENDING = "PENDING",
  CALLING = "CALLING",
  CALLED = "CALLED",
  FAILED = "FAILED",
  BUSY = "BUSY",
  NO_ANSWER = "NO_ANSWER",
  HOT = "HOT",
  WARM = "WARM",
  COLD = "COLD",
  CALL_BACK = "CALL_BACK",
  DO_NOT_CALL = "DO_NOT_CALL",
  NOT_INTERESTED = "NOT_INTERESTED",
}

const groq = new Groq({ apiKey: envConfig.GROK_API_KEY });


export interface Lead {
  id: string;
  fullName: string;
  phone: string;
  priority: number;
  userId: string;
}

/**
 * DSA: Priority Queue Implementation
 * Manages leads based on their priority (higher number = higher priority)
 */
export class PriorityCallQueue {
  private queue: Lead[] = [];

  enqueue(lead: Lead) {
    this.queue.push(lead);
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  dequeue(): Lead | undefined {
    return this.queue.shift();
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }

  getQueue() {
    return this.queue;
  }

  clear() {
    this.queue = [];
  }
}

export class DialerService {
  private static instance: DialerService;
  private userQueues: Map<string, PriorityCallQueue> = new Map(); // userId -> Queue
  private activeCalls: Map<string, { leadId?: string; contactId?: string; userId: string; sessionId?: string; isBrowserCall?: boolean; status?: string }> = new Map(); // SID -> Metadata
  private userActiveSessions: Map<string, string> = new Map(); // userId -> current sessionId
  private agentBusyState: Map<string, boolean> = new Map(); // userId -> boolean
  private agentBridgedCallId: Map<string, string> = new Map(); // userId -> callSid that holds the lock
  private userCallerIdPrefs: Map<string, string> = new Map(); // userId -> callerId
  private userCallerIdPools: Map<string, string[]> = new Map(); // userId -> list of Twilio numbers
  private userCallerIdIndices: Map<string, number> = new Map(); // userId -> last used index

  private constructor() { }

  public static getInstance(): DialerService {
    if (!DialerService.instance) {
      DialerService.instance = new DialerService();
    }
    return DialerService.instance;
  }

  private getOrCreateQueue(userId: string): PriorityCallQueue {
    if (!this.userQueues.has(userId)) {
      this.userQueues.set(userId, new PriorityCallQueue());
    }
    return this.userQueues.get(userId)!;
  }

  /**
   * Add leads to queue and trigger processing for that user.
   */
  async addLeadsToQueue(userId: string, leads: Lead[], callerId?: string | string[]) {
    if (callerId && !Array.isArray(callerId)) {
      this.userCallerIdPrefs.set(userId, callerId);
      this.userCallerIdPools.delete(userId); // Explicit single choice overrides rotation pool
      console.log(`[DialerService] Set single preferred callerId for user ${userId}: ${callerId}`);
    } else if (Array.isArray(callerId) && callerId.length > 0) {
      // Explicit list of IDs to rotate through
      this.userCallerIdPools.set(userId, callerId);
      this.userCallerIdIndices.set(userId, 0);
      this.userCallerIdPrefs.delete(userId);
      console.log(`[DialerService] Initialized explicit rotation pool for user ${userId} with ${callerId.length} numbers.`);
    } else {
      // IF no specific callerId provided, fetch ALL available ones for rotation
      try {
        const settings = await prisma.system_Setting.findFirst({
          where: { userId }
        });

        if (settings) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          const availableIds = await prisma.callerId.findMany({
            where: user?.role === "AGENT"
              ? { agents: { some: { id: userId } } }
              : { systemSettingId: settings.id },
            select: { twillioNumber: true }
          });

          const numbers = availableIds
            .map(id => id.twillioNumber)
            .filter((n): n is string => !!n);

          if (numbers.length > 0) {
            this.userCallerIdPools.set(userId, numbers);
            this.userCallerIdIndices.set(userId, 0);
            this.userCallerIdPrefs.delete(userId);
            console.log(`[DialerService] Initialized automatic rotation pool for user ${userId} with ${numbers.length} numbers.`);
          }
        }
      } catch (poolError) {
        console.error(`[DialerService] Failed to initialize callerId pool for user ${userId}:`, poolError);
      }
    }

    const queue = this.getOrCreateQueue(userId);
    leads.forEach((lead) => queue.enqueue(lead));

    // Process queue immediately
    this.processQueue(userId);
  }

  clearQueue(userId: string) {
    const queue = this.userQueues.get(userId);
    if (queue) {
      queue.clear();
      console.log(`[DialerService] Cleared queue for user ${userId}`);
    }

    // HARD RESET states to unblock stuck sessions
    this.agentBusyState.delete(userId);
    this.agentBridgedCallId.delete(userId);
    this.userActiveSessions.delete(userId);
    for (const [sid, metadata] of this.activeCalls.entries()) {
      if (metadata.userId === userId) {
        this.activeCalls.delete(sid);
      }
    }
    console.log(`[DialerService] Hardware reset of stuck states for user ${userId} complete.`);
  }

  /**
   * Filling up available lines for the user
   */
  // In processQueue — pre-assign caller IDs synchronously before async makeCall
  private async processQueue(userId: string) {
    const queue = this.userQueues.get(userId);
    if (!queue || queue.isEmpty()) return;

    const { isAllowed, autodialingEnabled } = await this.checkCompliance(userId);
    if (!autodialingEnabled || !isAllowed) return;

    const capacity = await this.getUserCapacity(userId);
    const currentActiveCount = Array.from(this.activeCalls.values())
      .filter((call) => call.userId === userId).length;

    if (this.isAgentBusy(userId)) return;

    // Pre-fetch the pool once
    const pool = this.userCallerIdPools.get(userId) || [];

    let inFlight = currentActiveCount;
    const callBatch: { lead: Lead; assignedNumber: string | null }[] = [];

    // 1. Synchronously assign numbers to all leads before any async work
    while (inFlight < capacity && !queue.isEmpty()) {
      const lead = queue.dequeue();
      if (!lead) break;

      let assignedNumber: string | null = null;

      if (pool.length > 0) {
        // Round-robin: grab current index, increment immediately
        let index = this.userCallerIdIndices.get(userId) || 0;
        assignedNumber = pool[index % pool.length];
        this.userCallerIdIndices.set(userId, (index + 1) % pool.length);
      }

      callBatch.push({ lead, assignedNumber });
      inFlight++;
    }

    // 2. Now fire calls with their pre-assigned numbers
    for (const { lead, assignedNumber } of callBatch) {
      this.makeCall(lead, assignedNumber);
      await new Promise(r => setTimeout(r, 250));
    }
  }

  private pendingCallsCount(userId: string): number {
    // This is a simple counter if we had a state for "initiating"
    // For now, activeCalls covers it once Twilio responds
    return 0;
  }

  private async getUserCapacity(userId: string): Promise<number> {
    try {
      // Find system settings for the user
      const settings = await prisma.system_Setting.findFirst({
        where: { userId },
        include: {
          caller_id: true,
          callSettings: true,
        },
      });

      // Default to 1 if no settings found
      if (!settings) return 1;

      // Extract numberOfLines from caller_id or callSettings
      const linesFromCallerId = settings.caller_id[0]?.numberOfLines || 1;
      const linesFromSettings = settings.callSettings[0]?.numberOfLines || 1;

      return Math.max(linesFromCallerId, linesFromSettings);
    } catch (error) {
      console.error(`Error fetching capacity for user ${userId}:`, error);
      return 1;
    }
  }

  public async checkCompliance(userId: string): Promise<{ isAllowed: boolean; autodialingEnabled: boolean }> {
    try {
      const settings = await prisma.system_Setting.findFirst({
        where: { userId },
        include: { regulatorySetting: true },
      });

      if (!settings || !settings.regulatorySetting) {
        return { isAllowed: true, autodialingEnabled: true }; // Default to allowed if no settings
      }

      const { tcpaFrom, tcpaTo, tcpaAutodialing } = settings.regulatorySetting;

      // Make timezone aware (defaults to UTC if no company found)
      let timeZone = "UTC";
      try {
        const company = await prisma.company.findFirst();
        if (company?.defaultTimeZone) {
          timeZone = company.defaultTimeZone;
        }
      } catch (e) { }

      const now = new Date();
      let currentStr = "";
      try {
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
        const parts = formatter.formatToParts(now);
        const hr = parts.find(p => p.type === 'hour')?.value || "00";
        const mn = parts.find(p => p.type === 'minute')?.value || "00";
        const adjustedHr = hr === '24' ? '00' : hr;
        currentStr = `${adjustedHr}:${mn}`;
      } catch (e) {
        currentStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      }

      let isAllowed = true;
      if (tcpaFrom && tcpaTo) {
        isAllowed = tcpaFrom <= tcpaTo
          ? (currentStr >= tcpaFrom && currentStr <= tcpaTo)
          : (currentStr >= tcpaFrom || currentStr <= tcpaTo);
      }


      return { isAllowed, autodialingEnabled: tcpaAutodialing };
    } catch (error) {
      console.error(`Error checking compliance for user ${userId}:`, error);
      return { isAllowed: true, autodialingEnabled: true };
    }
  }

  private async makeCall(lead: Lead, preAssignedNumber?: string | null) {
    try {

      await this.updateLeadStatusInDB(lead.id, "CALLING");

      const pool = this.userCallerIdPools.get(lead.userId);
      let fromNumber: string | undefined = preAssignedNumber || undefined;
      let selectedCallerId: any = null;

      // If a number was pre-assigned, look up its DB record for the callerIdId
      if (fromNumber) {
        selectedCallerId = await prisma.callerId.findFirst({
          where: { twillioNumber: fromNumber }
        });

        // Check if it's frozen — if so, fall through to find another
        const now = new Date();
        if (selectedCallerId?.unfreezeAt && selectedCallerId.unfreezeAt > now) {
          console.warn(`[makeCall] Pre-assigned number ${fromNumber} is frozen. Finding fallback.`);
          fromNumber = undefined;
          selectedCallerId = null;
        }
      }

      // Fallback: iterate pool to find a non-frozen number (edge case)
      if (!fromNumber && pool && pool.length > 0) {
        for (const num of pool) {
          const cidRecord = await prisma.callerId.findFirst({
            where: { twillioNumber: num }
          });
          const now = new Date();
          if (!cidRecord?.unfreezeAt || cidRecord.unfreezeAt <= now) {
            fromNumber = num;
            selectedCallerId = cidRecord;
            break;
          }
        }
      }

      // Final fallback: user default
      if (!fromNumber) {
        const user = await prisma.user.findUnique({
          where: { id: lead.userId },
          include: { defaultCaller: true }
        });
        fromNumber = user?.defaultCaller?.twillioNumber || envConfig.TWILIO_PHONE_NUMBER;
        selectedCallerId = user?.defaultCaller;
      }

      // 1. Update status to CALLING in DB
      await this.updateLeadStatusInDB(lead.id, "CALLING");

      // 2. Determine Caller ID (with Rotation Support)
      // const pool = this.userCallerIdPools.get(lead.userId);
      // let fromNumber = this.userCallerIdPrefs.get(lead.userId);
      // let selectedCallerId: any = null;

      if (pool && pool.length > 0) {
        let index = this.userCallerIdIndices.get(lead.userId) || 0;

        // Try up to pool.length times to find a non-frozen ID
        let found = false;
        for (let i = 0; i < pool.length; i++) {
          const currentNum = pool[index];
          index = (index + 1) % pool.length;
          this.userCallerIdIndices.set(lead.userId, index);

          // Check if this number is frozen
          const cidRecord = await prisma.callerId.findFirst({
            where: { twillioNumber: currentNum }
          });

          const now = new Date();
          const isFrozen = cidRecord?.unfreezeAt && cidRecord.unfreezeAt > now;

          if (!isFrozen) {
            fromNumber = currentNum;
            selectedCallerId = cidRecord;
            found = true;
            console.log(`[DialerService] Rotation: Picked ${fromNumber} (Index: ${index}) for user ${lead.userId}`);
            break;
          } else {
            console.log(`[DialerService] Rotation: Skipping frozen number ${currentNum} for user ${lead.userId}`);
          }
        }

        if (!found) {
          console.warn(`[DialerService] All numbers in pool for user ${lead.userId} are frozen! Using default.`);
        }
      }

      if (!fromNumber) {
        const user = await prisma.user.findUnique({
          where: { id: lead.userId },
          include: { defaultCaller: true }
        });
        fromNumber = user?.defaultCaller?.twillioNumber || envConfig.TWILIO_PHONE_NUMBER;
        selectedCallerId = user?.defaultCaller;
      }

      const twilioFrom = fromNumber?.startsWith('+') ? fromNumber : `+${fromNumber}`;

      // Also fetch system settings to get answeringMachineRecordingUrl
      const settings = await prisma.system_Setting.findFirst({
        where: { userId: lead.userId },
        include: { callSettings: { include: { answeringMachineRecording: true, busyRecording: true } } }
      });
      const amRecordingUrl = settings?.callSettings[0]?.answeringMachineRecording?.url || "";
      const busyRecordingUrl = settings?.callSettings[0]?.busyRecording?.url || "";

      // 3. Initiate Twilio Call
      const call = await client.calls.create({
        to: lead.phone,
        from: twilioFrom as string,
        url: `${envConfig.BACKEND_URL}/api/calling/webhooks/voice?agentId=${lead.userId}&contactId=${lead.id}&busyRecordingUrl=${encodeURIComponent(busyRecordingUrl)}`,
        statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status?agentId=${lead.userId}`,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
        machineDetection: "DetectMessageEnd",
        asyncAmd: "true",
        asyncAmdStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/amd-status?answeringMachineUrl=${encodeURIComponent(amRecordingUrl)}&agentId=${lead.userId}`,
        asyncAmdStatusCallbackMethod: "POST",
      });

      console.log(`[makeCall] Call initiated for user ${lead.userId} ${lead.fullName} (${lead.phone}) from ${twilioFrom}. SID: ${call.sid}`);
      const sessionId = this.userActiveSessions.get(lead.userId);
      this.activeCalls.set(call.sid, {
        leadId: lead.id,
        contactId: lead.id,
        userId: lead.userId,
        sessionId,
        status: "initiated"
      });

      // 3. Create CallRecord in DB immediately
      try {
        await prisma.callRecord.create({
          data: {
            callSid: call.sid,
            leadId: lead.id,
            userId: lead.userId,
            sessionId: sessionId || null,
            // @ts-ignore - Prisma client needs regeneration
            callerIdId: selectedCallerId?.id || null,
            status: "queued",
            startTime: new Date(),
          }
        });
        console.log(`[makeCall] SUCCESS: CallRecord created for SID: ${call.sid} with CallerId: ${selectedCallerId?.id || 'DEFAULT'}`);
      } catch (dbError: any) {
        console.error(`[makeCall] ERROR: CallRecord creation failed: ${dbError.message}`);
      }
    } catch (error: any) {
      console.error(`Failed to call lead ${lead.id}:`, error.message);
      await this.updateLeadStatusInDB(lead.id, "FAILED");

      // If a call failed to initiate, try to process next in queue
      this.processQueue(lead.userId);
    }
  }

  private getFullTranscript(callSid: string): string {
    const logs = this.transcriptionLogs.get(callSid) || [];
    return logs
      .map(l => `${l.speaker}: ${l.text}`)
      .join("\n");
  }

  async updateLeadStatusInDB(leadId: string, status: string) {
    try {
      await prisma.lead.update({
        where: { id: leadId },
        data: { status },
      });
      console.log(`Lead ${leadId} status updated to ${status} in DB.`);
    } catch (error: any) {
      console.error(`Error updating lead ${leadId} status in DB:`, error.message);
    }
  }

  getStatus(userId: string) {
    const queue = this.userQueues.get(userId);
    const userActiveCalls = Array.from(this.activeCalls.values()).filter(
      (c) => c.userId === userId
    );

    const leadStatuses: Record<string, string> = {};
    Array.from(this.activeCalls.values()).forEach(c => {
      const lid = c.leadId || c.contactId;
      if (c.userId === userId && lid) {
        leadStatuses[lid] = c.status || "initiated";
      }
    });

    return {
      queueSize: queue?.size() || 0,
      activeCallsCount: userActiveCalls.length,
      currentQueue: queue?.getQueue() || [],
      leadStatuses
    };
  }

  async analyzeSentiment(transcript: string) {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", // fast + powerful
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
            You are a sales call analyzer.

            Return ONLY valid JSON:
            {
              "sentiment": "positive" | "neutral" | "negative",
              "confidence": number (0-1),
              "lead_interest": "high" | "medium" | "low",
              "summary": "2-3 line short summary"
            }`
        },
        {
          role: "user",
          content: transcript
        }
      ]
    });

    return JSON.parse(completion.choices[0].message.content!);
  }

  async handleCallStatusUpdate(sid: string, twilioStatus: string, isChildLeg: boolean = false, providedAgentId?: string) {
    const metadata = this.activeCalls.get(sid);
    let userId = metadata?.userId || providedAgentId;

    if (metadata) {
      metadata.status = twilioStatus;
      this.activeCalls.set(sid, metadata);
    }

    // PROTECTION: For browser calls... (keep this or move below userId check?)
    // Actually, if metadata is missing we can't tell if it's a browser call.
    if (metadata?.isBrowserCall && !isChildLeg && (twilioStatus === "in-progress" || twilioStatus === "answered")) {
      console.log(`[handleCallStatusUpdate] Ignoring premature ${twilioStatus} from parent leg of browser call: ${sid}`);
      return;
    }

    let { leadId, contactId } = metadata || ({} as any);
    if (!userId) userId = providedAgentId;

    if (!userId) {
      console.warn(`[handleCallStatusUpdate] No metadata and no providedAgentId for SID ${sid}. Cannot track status.`);
      return;
    }
    let dbStatus: LeadCallStatus = LeadCallStatus.CALLED;
    const terminalStatuses = ["failed", "busy", "no-answer", "completed"];
    const isTerminal = terminalStatuses.includes(twilioStatus);

    if (twilioStatus === "failed") dbStatus = LeadCallStatus.FAILED;
    else if (twilioStatus === "busy") dbStatus = LeadCallStatus.BUSY;
    else if (twilioStatus === "no-answer") dbStatus = LeadCallStatus.NO_ANSWER;
    else if (twilioStatus === "completed") {
      dbStatus = LeadCallStatus.CALLED;
      this.clearTranscriptionLogs(sid);
    }

    if (leadId) {
      await this.updateLeadStatusInDB(leadId, dbStatus);
    }

    // Update CallRecord in DB
    try {
      const callRecord = await (prisma.callRecord as any).findUnique({ where: { callSid: sid } });

      if (callRecord) {
        const updateData: any = { status: twilioStatus };

        if (isTerminal) {
          const endTime = new Date();
          const duration = Math.floor((endTime.getTime() - callRecord.startTime.getTime()) / 1000); // in seconds
          updateData.endTime = endTime;
          updateData.sessionId = metadata?.sessionId;
          updateData.duration = duration;
          updateData.disposition = dbStatus;
        }

        await (prisma.callRecord as any).update({
          where: { callSid: sid },
          data: updateData
        });
        console.log(`[handleCallStatusUpdate] Updated CallRecord status to ${twilioStatus}${isTerminal ? ', duration: ' + updateData.duration + 's' : ''}`);
      }
    } catch (dbError: any) {
      console.error(`[handleCallStatusUpdate] ERROR: CallRecord update failed: ${dbError.message}`);
    }

    if (isTerminal) {
      console.log(`[handleCallStatusUpdate] Call ${sid} (isChild: ${isChildLeg}) reached terminal status: ${twilioStatus}`);

      // Only release the agent busy lock if THIS call is the one that was holding it!
      if (this.agentBridgedCallId.get(userId!) === sid) {
        console.log(`[handleCallStatusUpdate] Call ${sid} was the active bridge. Releasing agent ${userId}.`);
        this.setAgentBusy(userId!, false);
        this.agentBridgedCallId.delete(userId!);
      } else {
        console.log(`[handleCallStatusUpdate] Call ${sid} was not the active bridge. Skipping busy reset (Current lock: ${this.agentBridgedCallId.get(userId!)}).`);
      }

      this.activeCalls.delete(sid);
      console.log(`Call ${sid} finished (${twilioStatus}). Triggering next in queue for ${userId}`);
      this.processQueue(userId);
    }
  }

  async handleRecordingUpdate(callSid: string, recordingUrl: string, RecordingSid: string) {
    try {
      console.log(`[Recording] Updating for ${callSid}: ${recordingUrl}`);

      // 1. Download from Twilio and Upload to Cloudinary
      const cloudinaryUrl = await this.uploadRecordingToCloudinary(recordingUrl, callSid);


      const transcription = await groq.audio.transcriptions.create({
        url: cloudinaryUrl,
        model: "whisper-large-v3",
        temperature: 0,
        response_format: "verbose_json",
      });
      // AI Sentiments Logic should be implemented here
      const sentimentAnalysis = await this.analyzeSentiment(transcription.text);

      // console.log("sentimentAnalysis",sentimentAnalysis)

      Promise.allSettled([
        await prisma.callRecord.update({
          where: { callSid: callSid },
          data: { recordingUrl: cloudinaryUrl },
        }),
        await prisma.callAnalysis.upsert({
          where: { callSid: callSid },
          update: { recordingUrl: cloudinaryUrl },
          create: {
            callSid: callSid,
            leadId: "",
            recordingUrl: cloudinaryUrl,
            sentiment: sentimentAnalysis?.sentiment || "", // Placeholder for now
            confidence: sentimentAnalysis?.confidence || 0,
            aiSummary: sentimentAnalysis?.summary || "",
            transcript: transcription.text
          }
        })
      ])
      console.log(`[Cloudinary] Recording saved: ${cloudinaryUrl}`);
    } catch (error) {
      console.error("Failed to handle recording update:", error);
    }
  }

  private async uploadRecordingToCloudinary(twilioUrl: string, callSid: string): Promise<string> {
    const tempPath = path.join(os.tmpdir(), `recording-${callSid}.mp3`);
    try {
      const downloadUrl = twilioUrl.endsWith('.mp3') ? twilioUrl : `${twilioUrl}.mp3`;

      const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'stream',
        auth: {
          username: envConfig.TWILIO_ACCOUNT_SID!,
          password: envConfig.TWILIO_AUTH_TOKEN!
        }
      });

      const writer = fs.createWriteStream(tempPath);
      (response.data as any).pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve as any);
        writer.on('error', reject);
      });

      // Use the user's utility function
      const result = await cloudinaryUploader(tempPath);

      // Cleanup temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      return result?.secure_url!;
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw err;
    }
  }

  private transcriptionLogs: Map<string, Array<{ speaker: string, text: string, timestamp: Date }>> = new Map();

  addTranscription(callSid: string, speaker: string, text: string) {
    if (!this.transcriptionLogs.has(callSid)) {
      this.transcriptionLogs.set(callSid, []);
    }
    this.transcriptionLogs.get(callSid)?.push({ speaker, text, timestamp: new Date() });
    console.log(`[Transcription] ${callSid} (${speaker}): ${text}`);
  }

  getTranscriptionLogs(callSid?: string) {
    if (callSid) {
      return this.transcriptionLogs.get(callSid) || [];
    }
    // Return all for debugging or latest
    const all = Array.from(this.transcriptionLogs.values()).flat();
    return all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  clearTranscriptionLogs(callSid: string) {
    this.transcriptionLogs.delete(callSid);
  }

  // Agent State Management
  setAgentBusy(userId: string, busy: boolean, callSid?: string) {
    if (busy && callSid) {
      const existingLock = this.agentBridgedCallId.get(userId);
      if (existingLock && existingLock !== callSid) {
        console.log(`[AgentState] Lock already held by ${existingLock}, ignoring request from ${callSid}`);
        return;
      }
      this.agentBridgedCallId.set(userId, callSid);
    } else if (!busy) {
      this.agentBridgedCallId.delete(userId);
    }

    this.agentBusyState.set(userId, busy);
    console.log(`[AgentState] User ${userId} busy state set to: ${busy}`);
    if (!busy) {
      this.processQueue(userId);
    }
  }

  isAgentBusy(userId: string): boolean {
    return this.agentBusyState.get(userId) || false;
  }

  recycleLeadWithDelay(userId: string, leadId: string) {
    // Schedule lead to be requeued later or at lower priority
    setTimeout(async () => {
      try {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (lead) {
          const queue = this.getOrCreateQueue(userId);
          queue.enqueue({
            id: lead.id,
            fullName: lead.fullName,
            phone: lead.phone,
            priority: 0, // Lower priority or just push to queue
            userId: lead.userId
          });
          console.log(`[DialerService] Recycled lead ${leadId} after breather.`);
          this.processQueue(userId);
        }
      } catch (e) {
        console.error("Failed to recycle lead", e);
      }
    }, 15000); // 15 second breather
  }

  // Session Management
  setActiveSession(userId: string, sessionId: string) {
    this.userActiveSessions.set(userId, sessionId);
  }

  clearActiveSession(userId: string) {
    this.userActiveSessions.delete(userId);
  }
}

export const dialerService = DialerService.getInstance();