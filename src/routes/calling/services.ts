import { client } from "../../lib/config";
import prisma from "../../lib/prisma";
import { LeadCallStatus } from "@prisma/client";

export interface Lead {
  id: string;
  fullName: string;
  phone: string;
  priority: number;
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
  private queue: PriorityCallQueue;
  private isProcessing: boolean = false;
  private activeCalls: Map<string, string> = new Map(); // SID -> LeadID

  private constructor() {
    this.queue = new PriorityCallQueue();
  }

  public static getInstance(): DialerService {
    if (!DialerService.instance) {
      DialerService.instance = new DialerService();
    }
    return DialerService.instance;
  }

  /**
   * Add leads to queue and persist them in memory.
   * Note: Leads are expected to be already saved in DB.
   */
  async addLeadsToQueue(leads: Lead[]) {
    leads.forEach(lead => this.queue.enqueue(lead));
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  private async startProcessing() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    while (!this.queue.isEmpty()) {
      const lead = this.queue.dequeue();
      if (lead) {
        await this.makeCall(lead);
        // Wait for a bit before the next call to stagger them
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    this.isProcessing = false;
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
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });

      console.log(`Call initiated for ${lead.fullName} (${lead.phone}). SID: ${call.sid}`);
      this.activeCalls.set(call.sid, lead.id);
    } catch (error: any) {
      console.error(`Failed to call lead ${lead.id}:`, error.message);
      await this.updateLeadStatusInDB(lead.id, "FAILED");
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

  getStatus() {
    return {
      isProcessing: this.isProcessing,
      queueSize: this.queue.size(),
      activeCallsCount: this.activeCalls.size,
      currentQueue: this.queue.getQueue(),
    };
  }

  async handleCallStatusUpdate(sid: string, twilioStatus: string) {
    const leadId = this.activeCalls.get(sid);
    if (!leadId) return;

    let dbStatus: LeadCallStatus = "CALLED";

    if (twilioStatus === "failed") dbStatus = "FAILED";
    else if (twilioStatus === "busy") dbStatus = "BUSY";
    else if (twilioStatus === "no-answer") dbStatus = "NO_ANSWER";
    else if (twilioStatus === "completed") dbStatus = "CALLED";
    else return; // Ignore other statuses like 'ringing', 'initiated'

    await this.updateLeadStatusInDB(leadId, dbStatus);
    this.activeCalls.delete(sid);
  }

  async handleRecordingUpdate(callSid: string, recordingUrl: string) {
    const leadId = this.activeCalls.get(callSid); // This might be gone if call ended
    // Ideally we store CallSid -> LeadId somewhere more persistent if needed
    console.log(`Recording for Call ${callSid}: ${recordingUrl}`);
    // Here you could update the Lead record in DB with the recording URL
  }
}

export const dialerService = DialerService.getInstance();
