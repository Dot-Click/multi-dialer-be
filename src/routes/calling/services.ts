import { client } from "../../lib/config";
import prisma from "../../lib/prisma";
import { LeadCallStatus } from "@prisma/client";

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
  private activeCalls: Map<string, { leadId: string; userId: string }> = new Map(); // SID -> Metadata

  private constructor() {}

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
  async addLeadsToQueue(userId: string, leads: Lead[]) {
    const queue = this.getOrCreateQueue(userId);
    leads.forEach((lead) => queue.enqueue(lead));
    
    // Process queue immediately
    this.processQueue(userId);
  }

  /**
   * Filling up available lines for the user
   */
  private async processQueue(userId: string) {
    const queue = this.userQueues.get(userId);
    if (!queue || queue.isEmpty()) return;

    // 1. Get user capacity (simultaneous lines)
    const capacity = await this.getUserCapacity(userId);
    
    // 2. Count current active calls for this user
    const currentActiveCount = Array.from(this.activeCalls.values()).filter(
      (call) => call.userId === userId
    ).length;

    console.log(`User ${userId} capacity: ${capacity}, active: ${currentActiveCount}`);

    // 3. While we have capacity and leads in queue, make calls
    let inFlight = currentActiveCount;
    while (inFlight < capacity && !queue.isEmpty()) {
      const lead = queue.dequeue();
      if (lead) {
        inFlight++;
        // Trigger call initiation (non-blocking here to allow simultaneous calls)
        this.makeCall(lead);
      } else {
        break;
      }
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

  private async makeCall(lead: Lead) {
    try {
      // 1. Update status to CALLING in DB
      await this.updateLeadStatusInDB(lead.id, "CALLING");

      // 2. Initiate Twilio Call
      const call = await client.calls.create({
        to: lead.phone,
        from: process.env.TWILIO_PHONE_NUMBER as string,
        url: `${process.env.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/voice`,
        statusCallback: `${process.env.BACKEND_URL || 'https://multi-dialer-be-production.up.railway.app'}/api/calling/webhooks/call-status`,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
      });

      console.log(`Call initiated for ${lead.fullName} (${lead.phone}). SID: ${call.sid}`);
      this.activeCalls.set(call.sid, { leadId: lead.id, userId: lead.userId });
    } catch (error: any) {
      console.error(`Failed to call lead ${lead.id}:`, error.message);
      await this.updateLeadStatusInDB(lead.id, "FAILED");
      
      // If a call failed to initiate, try to process next in queue
      this.processQueue(lead.userId);
    }
  }

  async updateLeadStatusInDB(leadId: string, status: LeadCallStatus) {
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

    return {
      queueSize: queue?.size() || 0,
      activeCallsCount: userActiveCalls.length,
      currentQueue: queue?.getQueue() || [],
    };
  }

  async handleCallStatusUpdate(sid: string, twilioStatus: string) {
    const metadata = this.activeCalls.get(sid);
    if (!metadata) return;

    const { leadId, userId } = metadata;
    let dbStatus: LeadCallStatus = "CALLED";
    console.log("twilioStatus===>",twilioStatus)
    const terminalStatuses = ["failed", "busy", "no-answer", "completed"];
    if (!terminalStatuses.includes(twilioStatus)) return;

    if (twilioStatus === "failed") dbStatus = "FAILED";
    else if (twilioStatus === "busy") dbStatus = "BUSY";
    else if (twilioStatus === "no-answer") dbStatus = "NO_ANSWER";
    else if (twilioStatus === "completed") dbStatus = "CALLED";

    await this.updateLeadStatusInDB(leadId, dbStatus);
    
    // Remove from active calls
    this.activeCalls.delete(sid);

    // CALL IS FINISHED -> Automatically trigger next call for this user
    console.log(`Call ${sid} finished (${twilioStatus}). Triggering next in queue for ${userId}`);
    this.processQueue(userId);
  }

  async handleRecordingUpdate(callSid: string, recordingUrl: string) {
    const metadata = this.activeCalls.get(callSid);
    if (!metadata) return;
    
    console.log(`Recording for Call ${callSid} (Lead ${metadata.leadId}): ${recordingUrl}`);
    // Update Lead record with recording URL if needed
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
}

export const sssssssdialerService = DialerService.getInstance();
