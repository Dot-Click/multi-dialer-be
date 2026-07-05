import { client } from "@/lib/config";
import { getTwilioClient } from "../../services/twilio-account.service";
import prisma from "@/lib/prisma";
import axios from "axios";
import { uploadToR2 } from "@/utils/r2-uploader";
import { envConfig } from "@/lib/config";
import Groq from "groq-sdk";
import { moveToDncInDb } from "../contact/service";
import { resolveTenantRootId } from "../../utils/tenant";
import { resolveAdminId, recordCallAndRotateIfNeeded } from "../systemSettings/callerId/service";


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
  originalContactId?: string; // The frontend contact ID, used for UI sync
  queueCardId?: string; // The frontend per-phone queue card ID, used for UI status sync
  phoneIndex?: number;
  isRedial?: boolean;
  attempts?: number; // Track attempts in current session
}

/**
 * DSA: Priority Queue Implementation
 * Manages leads based on their priority (higher number = higher priority)
 */
export class PriorityCallQueue {
  private queue: Lead[] = [];

  enqueue(lead: Lead) {
    // Prevent duplicate entries for the same lead in the queue
    if (this.queue.some(l => l.id === lead.id)) {
      console.log(`[PriorityCallQueue] Lead ${lead.id} already in queue, skipping duplicate enqueue.`);
      return;
    }
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

  removeWhere(predicate: (lead: Lead) => boolean): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((lead) => !predicate(lead));
    return before - this.queue.length;
  }

  clear() {
    this.queue = [];
  }
}

// ── Formats the structured LLM output into a readable aiSummary string ─────────
function buildAiSummary(a: any): string {
  if (!a) return "";

  const lines: string[] = [];

  if (a.summary) lines.push(a.summary);

  if (Array.isArray(a.topics_discussed) && a.topics_discussed.length > 0) {
    lines.push(`Topics: ${a.topics_discussed.join(", ")}.`);
  }

  if (Array.isArray(a.objections) && a.objections.length > 0) {
    lines.push(`Objections: ${a.objections.join("; ")}.`);
  }

  if (a.next_steps && a.next_steps !== "none") {
    lines.push(`Next steps: ${a.next_steps}.`);
  }

  if (a.lead_interest) {
    lines.push(`Lead interest: ${a.lead_interest}. Outcome: ${a.call_outcome ?? "unknown"}.`);
  }

  return lines.join("\n\n");
}

export class DialerService {
  private static instance: DialerService;
  private userQueues: Map<string, PriorityCallQueue> = new Map(); // userId -> Queue
  private activeCalls: Map<string, { leadId?: string; contactId?: string; queueCardId?: string; userId: string; sessionId?: string; isBrowserCall?: boolean; status?: string; isRedial?: boolean; attempts?: number; amdPending?: boolean }> = new Map(); // SID -> Metadata
  private userActiveSessions: Map<string, string> = new Map(); // userId -> current sessionId
  private agentBusyState: Map<string, boolean> = new Map(); // userId -> boolean
  private agentBridgedCallId: Map<string, string> = new Map(); // userId -> callSid that holds the lock
  private userCallerIdPrefs: Map<string, string> = new Map(); // userId -> callerId
  private userCallerIdPools: Map<string, string[]> = new Map(); // userId -> list of Twilio numbers
  private pendingRedials: Map<string, Set<string>> = new Map(); // userId -> Set of leadIds
  private redialTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // `${userId}:${guardKey}` -> pending redial timer
  private userCallerIdIndices: Map<string, number> = new Map(); // userId -> last used index
  private userProcessingLocks: Map<string, boolean> = new Map(); // userId -> is currently processing queue
  private processedTerminalSids: Set<string> = new Set(); // Track SIDs that already triggered queue processing
  private agentPostCallState: Set<string> = new Set(); // userId
  private agentReadyState: Set<string> = new Set(); // userId
  /** userId -> the bridged callSid the agent dispositioned while it was still
   *  live/tearing down. Lets that call's own terminal webhook honor the ready
   *  signal instead of wiping it and stranding the agent back in post-call. */
  private agentReadyForCall: Map<string, string> = new Map();
  private sidToRootSid: Map<string, string> = new Map(); // childSid -> parentSid for logical association
  private lastActivity: Map<string, number> = new Map(); // userId -> timestamp
  private leadsInFlight: Map<string, Set<string>> = new Map(); // userId -> Set of leadIds in transit

  // ── Power Dialer additions ─────────────────────────────────────────────────
  /** Maps leadId -> phone number used on first dial. Ensures redials use the same Caller ID. */
  private leadToCallerIdMap: Map<string, string> = new Map();
  /** Maps userId -> session-level pacing override (max simultaneous calls). */
  private sessionPacing: Map<string, number> = new Map();
  /** Maps userId -> (caller-ID number -> calls placed this session). Powers the
   *  Caller ID Rotation usage counts shown in the power dialer. Reset when a new
   *  caller-ID pool is set (i.e. at the start of a session). */
  private userCallerIdCallCounts: Map<string, Map<string, number>> = new Map();
  /** Maps userId -> (caller-ID number -> unfreezeAtMs). Power dialer skips frozen numbers during round-robin. */
  private callerIdFreezeState: Map<string, Map<string, number>> = new Map();
  /** Maps userId -> (caller-ID number -> maxCallsBeforeFreeze). Populated when pool is set. 0 = no limit. */
  private callerIdPerNumberLimits: Map<string, Map<string, number>> = new Map();
  /** Maps userId -> session-level dials-per-caller-ID limit (sent by frontend as maxCallsPerId). */
  private callerIdSessionMaxCalls: Map<string, number> = new Map();
  /** Users who have explicitly stopped their dialer session — blocks in-flight processQueue batches. */
  private stoppedUsers: Set<string> = new Set();

  // ── Reconciliation watchdog (Layer 1) ──────────────────────────────────────
  /** Handle for the periodic reconciliation loop. */
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  /** SID -> last time we saw a real Twilio status for it (webhook or reconcile). */
  private sidLastStatusAt: Map<string, number> = new Map();
  /** userId -> first time we observed the agent parked in post-call (abandonment recovery). */
  private postCallEnteredAt: Map<string, number> = new Map();
  /** How often the watchdog reconciles in-memory state against Twilio truth. */
  private static readonly RECONCILE_INTERVAL_MS = 15_000;
  /** Only query Twilio for a call if we haven't heard a status for it in this long. */
  private static readonly CALL_STALE_MS = 45_000;
  /** Recover an agent stuck in post-call with no live calls after this long. */
  private static readonly POSTCALL_GRACE_MS = 3 * 60_000;

  private constructor() {
    // Start cleanup loop for stale associations every 30 minutes
    setInterval(() => {
      const now = Date.now();
      const thirtyMins = 30 * 60 * 1000;

      // Cleanup sidToRootSid entries that are no longer in activeCalls (approximate)
      if (this.sidToRootSid.size > 500) {
        this.sidToRootSid.clear();
      }

    }, 30 * 60 * 1000);
  }

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
   * @param pacing - optional session pacing override (max simultaneous calls)
   */
  async addLeadsToQueue(userId: string, leads: Lead[], callerId?: string | string[], pacing?: number, maxCallsPerId?: number) {
    // Clear any previous stop signal so a fresh session can dial normally.
    this.stoppedUsers.delete(userId);

    // ── Store session pacing ──────────────────────────────────────────────────
    if (pacing && pacing > 0) {
      this.sessionPacing.set(userId, pacing);
      console.log(`[DialerService] Session pacing set to ${pacing} for user ${userId}`);
    }

    // ── Store session-level dials-per-caller-ID limit ─────────────────────────
    if (maxCallsPerId && maxCallsPerId > 0) {
      this.callerIdSessionMaxCalls.set(userId, maxCallsPerId);
      console.log(`[DialerService] Dials-per-caller-ID limit set to ${maxCallsPerId} for user ${userId}`);
    }

    // ── Normalise Caller ID into a pool (always) ──────────────────────────────
    // FIX: A single string is wrapped into a 1-element array so the pool logic
    // is always used. Previously a single string was put in userCallerIdPrefs
    // but processQueue only reads userCallerIdPools, causing silent fallback.
    if (callerId) {
      let pool: string[] = [];
      if (Array.isArray(callerId)) {
        pool = callerId.filter(Boolean);
      } else if (typeof callerId === 'string') {
        // Split by comma or space and filter empties
        pool = callerId.split(/[, ]+/).map(n => n.trim()).filter(Boolean);
      }

      // ALWAYS set the pool if callerId is provided, even if empty
      this.userCallerIdPools.set(userId, pool);
      this.userCallerIdIndices.set(userId, 0);
      this.userCallerIdPrefs.delete(userId);
      this.userCallerIdCallCounts.set(userId, new Map()); // fresh usage counts for the session

      if (pool.length > 0) {
        console.log(`[DialerService] Caller ID pool set for user ${userId}: [${pool.join(', ')}]`);
        await this.loadCallerIdLimits(userId, pool);
      }
    } else {
      // No callerId provided — auto-fetch all available numbers for this user
      try {
        const settings = await prisma.system_Setting.findFirst({ where: { userId } });
        if (settings) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          const availableIds = await prisma.callerId.findMany({
            where: user?.role === "AGENT"
              ? { agents: { some: { id: userId } } }
              : { systemSettingId: settings.id },
            select: { twillioNumber: true }
          });
          const numbers = availableIds.map(id => id.twillioNumber).filter((n): n is string => !!n);
          if (numbers.length > 0) {
            this.userCallerIdPools.set(userId, numbers);
            this.userCallerIdIndices.set(userId, 0);
            this.userCallerIdPrefs.delete(userId);
            this.userCallerIdCallCounts.set(userId, new Map()); // fresh usage counts for the session
            console.log(`[DialerService] Auto-filled rotation pool for user ${userId} with ${numbers.length} numbers.`);
            await this.loadCallerIdLimits(userId, numbers);
          }
        }
      } catch (poolError) {
        console.error(`[DialerService] Failed to initialize callerId pool for user ${userId}:`, poolError);
      }
    }

    const queue = this.getOrCreateQueue(userId);
    leads.forEach((lead) => queue.enqueue(lead));
    this.agentPostCallState.delete(userId);

    // Process queue immediately
    this.processQueue(userId);
  }

  private async loadCallerIdLimits(userId: string, pool: string[]): Promise<void> {
    if (pool.length === 0) return;
    try {
      const settings = await prisma.system_Setting.findFirst({ where: { userId } });
      if (!settings) return;

      const records = await prisma.callerId.findMany({
        where: { twillioNumber: { in: pool }, systemSettingId: settings.id },
        select: { twillioNumber: true, numberOfLines: true, frozenAt: true, unfreezeAt: true, callCount: true }
      });

      const limitMap = new Map<string, number>();
      const freezeMap = new Map<string, number>();
      const callCountMap = new Map<string, number>();
      const nowMs = Date.now();

      for (const r of records) {
        if (!r.twillioNumber) continue;
        // Normalise to E.164 (matches twilioFrom key used in makeCall)
        const normalised = r.twillioNumber.startsWith('+') ? r.twillioNumber : `+${r.twillioNumber}`;

        // numberOfLines > 1 means a real dials-per-CID limit is configured
        if (r.numberOfLines && r.numberOfLines > 1) {
          limitMap.set(normalised, r.numberOfLines);
        }
        // Restore DB freeze state for numbers still in cooldown
        if (r.unfreezeAt) {
          const unfreezeMs = new Date(r.unfreezeAt).getTime();
          if (unfreezeMs > nowMs) {
            freezeMap.set(normalised, unfreezeMs);
          }
        }
        // Seed in-memory call count from DB so the UI shows the cumulative count
        // across sessions, not just the current session's calls
        const dbCount = (r as any).callCount ?? 0;
        if (dbCount > 0) {
          callCountMap.set(normalised, dbCount);
        }
      }

      this.callerIdPerNumberLimits.set(userId, limitMap);
      this.callerIdFreezeState.set(userId, freezeMap);
      // Merge DB counts into the session map (which was just reset to empty by addLeadsToQueue)
      const existingMap = this.userCallerIdCallCounts.get(userId) ?? new Map<string, number>();
      callCountMap.forEach((count, num) => existingMap.set(num, count));
      this.userCallerIdCallCounts.set(userId, existingMap);

      if (limitMap.size > 0) {
        console.log(`[DialerService] Caller ID limits loaded for user ${userId}:`, Object.fromEntries(limitMap));
      }
      if (callCountMap.size > 0) {
        console.log(`[DialerService] Caller ID counts seeded from DB for user ${userId}:`, Object.fromEntries(callCountMap));
      }
    } catch (e) {
      console.error(`[DialerService] Failed to load caller ID limits for ${userId}:`, e);
    }
  }

  async clearQueue(userId: string) {
    // Signal any in-progress processQueue batch to stop firing new calls immediately.
    this.stoppedUsers.add(userId);

    const queue = this.userQueues.get(userId);
    if (queue) {
      queue.clear();
      console.log(`[DialerService] Cleared queue for user ${userId}`);
    }

    // Capture this user's live call SIDs BEFORE wiping the activeCalls map.
    // Clearing the in-memory map does NOT terminate the Twilio calls — any
    // already-dialed/ringing legs would keep ringing and could still bridge to
    // the agent after they have left the session. We hang them up explicitly.
    const sidsToHangup: string[] = [];
    for (const [sid, metadata] of this.activeCalls.entries()) {
      if (metadata.userId === userId) sidsToHangup.push(sid);
    }

    // HARD RESET states to unblock stuck sessions
    this.agentBusyState.delete(userId);
    this.agentBridgedCallId.delete(userId);
    this.agentPostCallState.delete(userId);
    this.postCallEnteredAt.delete(userId);
    this.agentReadyState.delete(userId);
    this.agentReadyForCall.delete(userId);
    this.userActiveSessions.delete(userId);
    this.lastActivity.delete(userId);
    this.sessionPacing.delete(userId);
    // Drop in-flight leads so an in-progress processQueue pass can't keep dialing
    this.leadsInFlight.delete(userId);
    for (const [sid, metadata] of this.activeCalls.entries()) {
      if (metadata.userId === userId) {
        this.activeCalls.delete(sid);
        this.sidToRootSid.delete(sid);
      }
    }

    // Best-effort: terminate any live Twilio calls for this user so nothing
    // bridges to them after they leave.
    if (sidsToHangup.length > 0) {
      try {
        const userClient = await getTwilioClient(userId);
        await Promise.all(sidsToHangup.map(async (sid) => {
          try {
            await userClient.calls(sid).update({ status: "completed" });
            console.log(`[DialerService] Hung up live call ${sid} for user ${userId}`);
          } catch (e: any) {
            // Call may already be completed/failed — safe to ignore.
            console.warn(`[DialerService] Could not hang up call ${sid}: ${e?.message}`);
          }
        }));
      } catch (e: any) {
        console.warn(`[DialerService] Twilio client unavailable for hangup: ${e?.message}`);
      }
    }

    // Clear sticky caller ID mappings for this user's leads
    // We identify them by checking leads that belonged to this user's active calls
    // (leadToCallerIdMap is shared so we leave it — it persists per-lead across sessions)
    console.log(`[DialerService] Hardware reset of stuck states for user ${userId} complete.`);
  }

  removeQueuedContactCards(userId: string, contactId: string, exceptQueueCardId?: string) {
    const queue = this.userQueues.get(userId);
    if (!queue || !contactId) return 0;

    const removed = queue.removeWhere((lead) => (
      lead.originalContactId === contactId &&
      (!exceptQueueCardId || lead.queueCardId !== exceptQueueCardId)
    ));

    if (removed > 0) {
      console.log(`[DialerService] Removed ${removed} queued phone cards for contact ${contactId}`);
    }

    return removed;
  }

  /**
   * True when a rotation pool is configured AND every number in it is currently
   * frozen (in per-number dial-limit cooldown). When this holds there is no
   * legal number left to dial, so the session should end rather than fall back
   * to dialing on a frozen or default number.
   */
  private areAllCallerIdsFrozen(userId: string): boolean {
    const pool = this.userCallerIdPools.get(userId) || [];
    if (pool.length === 0) return false;
    const freezeMap = this.callerIdFreezeState.get(userId);
    if (!freezeMap) return false;
    const nowMs = Date.now();
    return pool.every((num) => {
      const unfreezeAt = freezeMap.get(num);
      return !!unfreezeAt && unfreezeAt > nowMs;
    });
  }

  /**
   * Filling up available lines for the user
   */
  // In processQueue — pre-assign caller IDs synchronously before async makeCall
  private async processQueue(userId: string) {
    if (this.agentPostCallState.has(userId)) {
      console.log(`[Dialer] Agent ${userId} in post-call state, holding queue`);
      return;
    }

    // Prevent concurrent processing for the same user (race condition guard)
    if (this.userProcessingLocks.get(userId)) {
      console.log(`[processQueue] Already processing for user ${userId}, skipping.`);
      return;
    }
    this.userProcessingLocks.set(userId, true);

    try {
      const queue = this.userQueues.get(userId);
      if (!queue || queue.isEmpty()) return;

      const { isAllowed, autodialingEnabled } = await this.checkCompliance(userId);
      if (!autodialingEnabled || !isAllowed) return;

      const capacity = await this.getUserCapacity(userId);
      const currentActiveCount = Array.from(this.activeCalls.values())
        .filter((call) => call.userId === userId).length
        + (this.leadsInFlight.get(userId)?.size ?? 0);

      if (this.isAgentBusy(userId)) return;

      // Pre-fetch the pool once
      const pool = this.userCallerIdPools.get(userId) || [];

      // If a caller-ID pool is configured but EVERY number is frozen (all hit
      // their per-number dial cap), stop dialing entirely. Do NOT fall back to a
      // frozen/default number. The session ends once any in-flight calls finish
      // (surfaced to the frontend via getStatus().allCallerIdsFrozen).
      if (pool.length > 0 && this.areAllCallerIdsFrozen(userId)) {
        console.log(`[processQueue] All caller IDs frozen for user ${userId} — halting dialing; session will end.`);
        return;
      }

      let inFlight = currentActiveCount;
      const callBatch: { lead: Lead; assignedNumber: string | null }[] = [];

      // 1. Synchronously assign numbers to all leads before any async work
      //    Priority: sticky (previously used) > Round-Robin from pool
      while (inFlight < capacity && !queue.isEmpty()) {
        const lead = queue.dequeue();
        if (!lead) break;

        let assignedNumber: string | null = null;

        if (pool.length > 0) {
          // ROUND-ROBIN with freeze-skip: find the next non-frozen number
          const nowMs = Date.now();
          const freezeMap = this.callerIdFreezeState.get(userId);
          const startIndex = this.userCallerIdIndices.get(userId) || 0;
          let foundIdx = -1;

          for (let attempt = 0; attempt < pool.length; attempt++) {
            const idx = (startIndex + attempt) % pool.length;
            const candidate = pool[idx];
            const unfreezeAt = freezeMap?.get(candidate);
            if (!unfreezeAt || nowMs >= unfreezeAt) {
              foundIdx = idx;
              break;
            }
          }

          if (foundIdx >= 0) {
            assignedNumber = pool[foundIdx];
            this.userCallerIdIndices.set(userId, (foundIdx + 1) % pool.length);
            console.log(`[processQueue] Round-robin assignment: lead ${lead.id} -> ${assignedNumber} (index ${foundIdx})`);
          } else {
            // No non-frozen number available (the pre-loop guard normally
            // catches this; this is a safety net). Put the lead back untouched
            // and stop pulling — never dial on a frozen caller ID.
            queue.enqueue(lead);
            console.log(`[processQueue] All caller IDs frozen for user ${userId} — stopping batch without dialing.`);
            break;
          }
        }

        // Track as "in-flight" to prevent the "empty session" gap during async makeCall setup
        if (!this.leadsInFlight.has(userId)) this.leadsInFlight.set(userId, new Set());
        this.leadsInFlight.get(userId)!.add(lead.id);

        callBatch.push({ lead, assignedNumber });
        inFlight++;
      }

      // 2. Now fire calls with their pre-assigned numbers
      for (const { lead, assignedNumber } of callBatch) {
        // If the agent clicked "Hangup & Leave" while this batch was building,
        // abort immediately so no more Twilio calls get initiated.
        if (this.stoppedUsers.has(userId)) {
          console.log(`[processQueue] User ${userId} stopped mid-batch — aborting remaining ${callBatch.length} call(s)`);
          break;
        }
        this.makeCall(lead, assignedNumber);
        await new Promise(r => setTimeout(r, 250));
      }
    } finally {
      this.userProcessingLocks.set(userId, false);
    }
  }

  private pendingCallsCount(userId: string): number {
    // This is a simple counter if we had a state for "initiating"
    // For now, activeCalls covers it once Twilio responds
    return 0;
  }

  async agentReady(userId: string): Promise<void> {
    this.agentReadyState.add(userId);
    this.agentPostCallState.delete(userId);
    this.postCallEnteredAt.delete(userId);
    // If the agent dispositioned while the bridged call is still live (or its
    // terminal webhook hasn't landed yet), record which call this ready is for.
    // handleCallStatusUpdate honors it so the call's own teardown doesn't re-arm
    // post-call and force the agent to click a disposition a second time.
    const lockSid = this.agentBridgedCallId.get(userId);
    if (lockSid) {
      this.agentReadyForCall.set(userId, lockSid);
    }
    await this.processQueue(userId);
  }

  private async getUserCapacity(userId: string): Promise<number> {
    // Session-level pacing always wins — this is the agent's explicit choice
    const pacingOverride = this.sessionPacing.get(userId);
    if (pacingOverride && pacingOverride > 0) {
      console.log(`[getUserCapacity] Using session pacing ${pacingOverride} for user ${userId}`);
      return pacingOverride;
    }

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

  // Returns a reason string if this number must NOT be dialed, else null.
  private async isDialBlocked(
    userId: string,
    contactId: string | undefined,
    number: string,
  ): Promise<string | null> {
    try {
      if (contactId) {
        const contact = await prisma.contact.findUnique({
          where: { id: contactId },
          select: { status: true },
        });
        if (contact?.status === "DO_NOT_CALL") return "contact is DNC";
      }

      if (number) {
        const phone = await prisma.contactPhone.findFirst({
          where: { number, ...(contactId ? { contactId } : {}) },
          select: { isValid: true, isDnc: true },
        });
        if (phone?.isValid === false) return "number marked Bad Number";
        if (phone?.isDnc === true) return "number marked DNC";

        const rootId = await resolveTenantRootId(userId);
        const suppressed = await prisma.suppressedNumber.findFirst({
          where: { userId: rootId, number },
          select: { id: true },
        });
        if (suppressed) return "number globally suppressed";
      }
    } catch (e: any) {
      // Fail open — a lookup error must not silently halt dialing.
      console.warn(`[isDialBlocked] lookup failed: ${e?.message}`);
    }
    return null;
  }

  private async makeCall(lead: Lead, preAssignedNumber?: string | null) {
    try {

      await this.updateLeadStatusInDB(lead.id, "CALLING");

      const pool = this.userCallerIdPools.get(lead.userId);
      // Priority: preAssignedNumber (from round-robin) > sticky (previously used) > fallback
      let fromNumber: string | undefined = preAssignedNumber || this.leadToCallerIdMap.get(lead.id) || undefined;
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

      // If a rotation pool is configured but we still have no number, every pool
      // number froze at dial time. Do NOT dial on the account default — abort so
      // the session ends (all caller IDs frozen ⇒ stop calling). Clean up the
      // in-flight/redial guards so getStatus reflects reality.
      if (!fromNumber && pool && pool.length > 0) {
        console.warn(`[makeCall] All caller IDs frozen at dial time for user ${lead.userId}. Aborting dial for lead ${lead.id}.`);
        this.leadsInFlight.get(lead.userId)?.delete(lead.id);
        this.pendingRedials.get(lead.userId)?.delete(lead.queueCardId || lead.originalContactId || lead.id);
        return;
      }

      // Final fallback: user default (only when NO rotation pool is configured)
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
      const amdEnabled = settings?.callSettings[0]?.amdEnabled ?? false;

      // Guard: Check if lead.userId is missing, empty, "undefined", or "null"
      if (!lead.userId || lead.userId === 'undefined' || lead.userId === 'null') {
        console.error(`[makeCall] ERROR: Missing or invalid userId for lead ${lead.id}`);
        await this.updateLeadStatusInDB(lead.id, "FAILED");
        return;
      }

      let dialTo = lead.phone;
      if (!dialTo && lead.originalContactId && typeof lead.phoneIndex === "number") {
        const contact = await prisma.contact.findUnique({
          where: { id: lead.originalContactId },
          include: { phones: true }
        });
        dialTo = contact?.phones?.[lead.phoneIndex]?.number || "";
      }

      // Honor call-outcome suppression: never dial a DNC contact, an invalid
      // (Bad Number) phone, a DNC-flagged phone, or a globally suppressed number.
      const blockReason = await this.isDialBlocked(lead.userId, lead.originalContactId, dialTo);
      if (blockReason) {
        console.log(`[makeCall] SKIP lead ${lead.id} (${dialTo}) — ${blockReason}`);
        await this.updateLeadStatusInDB(lead.id, "SKIPPED");
        this.leadsInFlight.get(lead.userId)?.delete(lead.id);
        // Fill the freed line with the next lead.
        this.processQueue(lead.userId);
        return;
      }

      // 3. Initiate Twilio Call
      const userClient = await getTwilioClient(lead.userId);
      const call = await userClient.calls.create({
        to: dialTo,
        from: twilioFrom as string,
        // Cap ring time so an unanswered lead releases its pacing slot promptly
        // instead of holding it for Twilio's ~60s default. Matches the manual-dial
        // ring window and lets the dialer advance to the next contact sooner.
        timeout: 30,
        url: `${envConfig.BACKEND_URL}/api/calling/webhooks/voice?agentId=${lead.userId}&leadId=${lead.id}&contactId=${lead.originalContactId || lead.id}&queueCardId=${lead.queueCardId || lead.id}&busyRecordingUrl=${encodeURIComponent(busyRecordingUrl)}${amdEnabled ? '&amdEnabled=true' : ''}`,
        statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status?agentId=${lead.userId}`,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
        ...(amdEnabled ? {
          machineDetection: "Enable",
          // Cap AMD at 20s so a result (machine, or human/unknown on timeout) always
          // arrives before the voice webhook's 30s hold-pause hangs the call up.
          // Without this, Twilio's 30s default could exceed a shorter pause and drop
          // a slow/silent human before they could be bridged. Keep this < the pause
          // length in handleVoiceWebhook, with margin for the callback + bridge redirect.
          machineDetectionTimeout: 20,
          asyncAmd: "true",
          asyncAmdStatusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/amd-status?answeringMachineUrl=${encodeURIComponent(amRecordingUrl)}&agentId=${lead.userId}&amdEnabled=true&contactId=${encodeURIComponent(lead.originalContactId || lead.id)}&leadId=${encodeURIComponent(lead.id)}&queueCardId=${encodeURIComponent(lead.queueCardId || lead.id)}&callerFrom=${encodeURIComponent(twilioFrom as string)}&busyRecordingUrl=${encodeURIComponent(busyRecordingUrl)}`,
          asyncAmdStatusCallbackMethod: "POST",
        } : {}),
      });

      console.log(`[makeCall] Call initiated for user ${lead.userId} ${lead.fullName} (${dialTo}) from ${twilioFrom}. SID: ${call.sid}`);
      const sessionId = this.userActiveSessions.get(lead.userId);
      this.activeCalls.set(call.sid, {
        leadId: lead.id,
        contactId: lead.originalContactId || lead.id,
        queueCardId: lead.queueCardId || lead.id,
        userId: lead.userId,
        sessionId,
        // With asyncAMD the contact answers but agent isn't bridged yet — keep as
        // "amd-pending" so the frontend shows Ringing, not Connected.
        status: amdEnabled ? "amd-pending" : (lead.isRedial ? "redialing" : "initiated"),
        amdPending: amdEnabled,
        isRedial: lead.isRedial,
        attempts: lead.attempts || 1
      });

      // CLEANUP: Remove from pending redials guard ONLY after the call is active in memory.
      // This prevents the "empty session" gap during makeCall's async setup.
      const guardKey = lead.queueCardId || lead.originalContactId || lead.id;
      this.pendingRedials.get(lead.userId)?.delete(guardKey);

      // ALSO remove from leadsInFlight now that it's active in memory
      this.leadsInFlight.get(lead.userId)?.delete(lead.id);
      this.lastActivity.set(lead.userId, Date.now());
      // Seed the watchdog's last-seen clock so a brand-new call isn't queried
      // against Twilio until it has actually had time to go stale.
      this.sidLastStatusAt.set(call.sid, Date.now());

      // ── Sticky Caller ID: record which number was used for this lead ──────
      if (fromNumber && !this.leadToCallerIdMap.has(lead.id)) {
        // Normalise to E.164 before storing
        const normalised = fromNumber.startsWith('+') ? fromNumber : `+${fromNumber}`;
        this.leadToCallerIdMap.set(lead.id, normalised);
        console.log(`[makeCall] Sticky Caller ID recorded: lead ${lead.id} -> ${normalised}`);
      }

      // ── Caller ID usage: count this call and freeze when the per-number limit is hit ──
      if (fromNumber) {
        let counts = this.userCallerIdCallCounts.get(lead.userId);
        if (!counts) {
          counts = new Map();
          this.userCallerIdCallCounts.set(lead.userId, counts);
        }
        const newCount = (counts.get(twilioFrom) || 0) + 1;
        counts.set(twilioFrom, newCount);

        // Use session-level limit (from frontend maxCallsPerId) or fall back to per-number DB limit
        const maxCalls = this.callerIdSessionMaxCalls.get(lead.userId)
          || this.callerIdPerNumberLimits.get(lead.userId)?.get(twilioFrom)
          || 0;

        if (maxCalls > 0 && newCount >= maxCalls) {
          const unfreezeAtMs = Date.now() + 20 * 60 * 1000; // 20 min cooldown
          if (!this.callerIdFreezeState.has(lead.userId)) {
            this.callerIdFreezeState.set(lead.userId, new Map());
          }
          this.callerIdFreezeState.get(lead.userId)!.set(twilioFrom, unfreezeAtMs);
          // Reset count so it starts fresh after the cooldown
          counts.set(twilioFrom, 0);
          console.log(`[Dialer] Caller ID ${twilioFrom} frozen for user ${lead.userId} after ${newCount}/${maxCalls} dials. Unfreezes at ${new Date(unfreezeAtMs).toISOString()}`);
        }

        // Sync usage to DB in background (fire-and-forget)
        if (maxCalls > 0) {
          resolveAdminId(lead.userId)
            .then(adminId => recordCallAndRotateIfNeeded(adminId, twilioFrom, maxCalls))
            .catch(err => console.error(`[Dialer] Failed to sync caller ID usage to DB:`, err));
        }
      }

      // 3. Create CallRecord in DB immediately
      try {
        await prisma.callRecord.create({
          data: {
            callSid: call.sid,
            leadId: lead.id,
            contactId: lead.originalContactId || null,
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
      
      // Cleanup on failure too
      const guardKey = lead.queueCardId || lead.originalContactId || lead.id;
      this.pendingRedials.get(lead.userId)?.delete(guardKey);
      this.leadsInFlight.get(lead.userId)?.delete(lead.id);

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
      // Single round-trip instead of findFirst + update. The `status: { not }`
      // guard makes this a no-op write when the value is unchanged, which kills the
      // redundant identical writes fired by every non-terminal status event
      // (initiated/ringing/in-progress/answered all map to CALLING). updateMany
      // also never throws when the lead is missing — it just reports count 0.
      const { count } = await prisma.lead.updateMany({
        where: { id: leadId, status: { not: status } },
        data: { status },
      });
      if (count > 0) {
        console.log(`Lead ${leadId} status updated to ${status} in DB.`);
      }
    } catch (error: any) {
      console.error(`Error updating lead ${leadId} status in DB:`, error.message);
    }
  }

  private async isLeadMachineDetected(leadId: string): Promise<boolean> {
    try {
      const lead = await prisma.lead.findFirst({ where: { id: leadId } });
      return lead?.status === "MACHINE";
    } catch {
      return false;
    }
  }

  getStatus(userIdRaw: string) {
    const userId = userIdRaw?.toString().trim();
    if (!userId) {
      console.warn("[DialerService] getStatus called without userId");
      return { queueSize: 0, activeCallsCount: 0, pendingRedialsCount: 0, leadStatuses: {}, leadSids: {}, callerIdStats: {} };
    }

    const queue = this.userQueues.get(userId);
    const inFlightCount = this.leadsInFlight.get(userId)?.size || 0;
    
    // Filter active calls with normalization
    const userActiveCalls = Array.from(this.activeCalls.values()).filter(
      (c) => c.userId?.toString().trim() === userId
    );

    const leadStatuses: Record<string, string> = {};
    const leadSids: Record<string, string> = {};
    
    // 1. Add active calls from memory
    Array.from(this.activeCalls.entries()).forEach(([sid, c]) => {
      const lid = c.queueCardId || c.contactId || c.leadId;
      const cUserId = c.userId?.toString().trim();
      
      if (cUserId === userId && lid) {
        if (c.isRedial && (c.status === "initiated" || c.status === "ringing")) {
          leadStatuses[lid] = "redialing";
        } else {
          leadStatuses[lid] = c.status || "initiated";
        }
        leadSids[lid] = sid;
      }
    });

    // 2. Add pending redials so the frontend sees them as 'Callback' (Amber) 
    this.pendingRedials.get(userId)?.forEach(lid => {
      leadStatuses[lid] = "callback";
    });

    const activeCount = userActiveCalls.length + inFlightCount;
    const pendingRedialsCount = this.pendingRedials.get(userId)?.size || 0;
    const queueSize = queue?.size() || 0;

    // Per-caller-ID usage counts and freeze state for this session (powers the Caller ID Rotation widget).
    const callerIdStats: Record<string, { callCount: number; isFrozen: boolean; unfreezeAt: number | null }> = {};
    const freezeMap = this.callerIdFreezeState.get(userId);
    const nowMs = Date.now();
    const maxCalls = this.callerIdSessionMaxCalls.get(userId) || 0;
    // Include all pool numbers, not just those with non-zero counts
    const pool = this.userCallerIdPools.get(userId) || [];
    pool.forEach(number => {
      const count = this.userCallerIdCallCounts.get(userId)?.get(number) || 0;
      const unfreezeAtMs = freezeMap?.get(number) ?? null;
      const isFrozen = unfreezeAtMs !== null && unfreezeAtMs > nowMs;
      callerIdStats[number] = { callCount: isFrozen ? maxCalls : count, isFrozen, unfreezeAt: unfreezeAtMs };
    });
    // Also include any numbers tracked in callCounts but not in pool (safety net)
    this.userCallerIdCallCounts.get(userId)?.forEach((count, number) => {
      if (!callerIdStats[number]) {
        const unfreezeAtMs = freezeMap?.get(number) ?? null;
        const isFrozen = unfreezeAtMs !== null && unfreezeAtMs > nowMs;
        callerIdStats[number] = { callCount: isFrozen ? maxCalls : count, isFrozen, unfreezeAt: unfreezeAtMs };
      }
    });

    if (activeCount === 0 && pendingRedialsCount === 0 && queueSize === 0) {
        console.log(`[getStatus] REPORTING EMPTY for ${userId}. activeCalls: ${userActiveCalls.length}, inFlight: ${inFlightCount}, pending: ${pendingRedialsCount}, queue: ${queueSize}`);
    }

    return {
      queueSize,
      activeCallsCount: activeCount,
      pendingRedialsCount,
      inFlightCount,
      currentQueue: queue?.getQueue() || [],
      leadStatuses,
      leadSids,
      callerIdStats,
      allCallerIdsFrozen: this.areAllCallerIdsFrozen(userId),
      isPostCall: this.agentPostCallState.has(userId),
    };
  }

  async analyzeSentiment(transcript: string) {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert sales call analyst for an outbound real estate dialing platform.
You will receive the full transcript of a recorded sales call.
Your job is to produce a highly accurate, detailed analysis of exactly what was said and what happened.

SENTIMENT RULES — be precise, not generous:
• "positive"  — prospect is actively engaged: asks questions, expresses interest, agrees to a next step, or requests more information.
• "neutral"   — prospect is polite but non-committal: willing to listen but gives no real signal either way, asks to call back at a vague future time, or gives soft deflections.
• "negative"  — prospect is disengaged or hostile: says they're not interested, asks to be removed from the list, hangs up quickly, raises hard objections, or is clearly dismissive.

ACCURACY RULES:
• Report ONLY what is explicitly in the transcript — do not invent or infer details not present.
• If the call was short (under 30 seconds) or the prospect immediately declined, reflect that accurately.
• Quotes or paraphrases from the transcript are preferred over generic observations.
• If the transcript is empty, too short, or unintelligible, set sentiment to "neutral" and note it in the summary.

COMPLIANCE RULES — flag ONLY what is explicitly present in the transcript:
• Do-not-call / opt-out: prospect says "stop calling", "remove me from your list", "do not call me again", "put me on your do-not-call list".
• Missing recording disclosure: the call is recorded but the agent never disclosed it (only flag if it's clearly a two-party conversation with no disclosure).
• Abusive / inappropriate language: profanity, harassment, threats, or discriminatory language from EITHER party.
• Misrepresentation: agent makes false or misleading claims (guarantees, fake urgency, impersonation).
• Do NOT invent compliance issues. If none are present, return empty arrays.

Return ONLY valid JSON in this exact structure (no extra keys, no markdown):
{
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": <float 0.0–1.0 reflecting how certain you are>,
  "lead_interest": "high" | "medium" | "low" | "none",
  "topics_discussed": [<specific topics mentioned, e.g. "property listing on Main St", "pricing", "viewing availability">],
  "objections": [<exact objections raised, e.g. "already working with another agent", "not the right time">],
  "next_steps": "<agreed follow-up action, or 'none'>",
  "call_outcome": "interested" | "callback_requested" | "not_interested" | "voicemail" | "hung_up_early" | "no_meaningful_conversation",
  "compliance_flags": [<short labels for any compliance issue detected, e.g. "do-not-call requested", "no recording disclosure", "abusive language", "misrepresentation"; empty array if none>],
  "risk_phrases": [<exact sensitive or non-compliant phrases spoken, verbatim from the transcript; empty array if none>],
  "summary": "<4–6 sentences describing: (1) how the call opened, (2) what topics came up, (3) how the prospect responded to key points, (4) any objections and how they were handled, (5) how the call ended and what was agreed>"
}`
        },
        {
          role: "user",
          content: transcript.trim() || "(No transcript available — call may have been too short or silent.)"
        }
      ]
    });

    return JSON.parse(completion.choices[0].message.content!);
  }

  async handleCallStatusUpdate(sid: string, twilioStatusRaw: string, isChildLeg: boolean = false, providedAgentIdRaw?: string) {
    const twilioStatus = twilioStatusRaw.toLowerCase();
    const providedAgentId = providedAgentIdRaw?.toString().trim();
    const metadata = this.activeCalls.get(sid);
    let userId = metadata?.userId?.toString().trim() || providedAgentId;

    if (metadata) {
      // PROTECTION: If this call is already marked as 'callback' (overflow),
      // do not let Twilio's 'answered' or 'in-progress' events turn it back to Green.
      if (metadata.status === 'callback' && (twilioStatus === 'answered' || twilioStatus === 'in-progress')) {
        console.log(`[handleCallStatusUpdate] Protecting 'callback' status for SID ${sid}. Ignoring '${twilioStatus}'.`);
      } else if ((metadata as any).amdPending && (twilioStatus === 'answered' || twilioStatus === 'in-progress')) {
        // AMD is still running — contact answered but agent not bridged yet.
        // Keep "amd-pending" so the frontend shows Ringing rather than Connected.
        console.log(`[handleCallStatusUpdate] AMD pending for ${sid} — keeping 'amd-pending', ignoring '${twilioStatus}'.`);
      } else {
        metadata.status = twilioStatus;
        this.activeCalls.set(sid, metadata);
      }
    }

    if (userId) {
      this.lastActivity.set(userId, Date.now());
    }
    // Record that we just heard a real status for this SID, so the reconciliation
    // watchdog only queries Twilio for calls that have gone quiet (missed webhooks),
    // not ones that are actively reporting.
    this.sidLastStatusAt.set(sid, Date.now());

    // PROTECTION: For browser calls... (keep this or move below userId check?)
    // Actually, if metadata is missing we can't tell if it's a browser call.
    if (metadata?.isBrowserCall && !isChildLeg && (twilioStatus === "in-progress" || twilioStatus === "answered")) {
      console.log(`[handleCallStatusUpdate] Ignoring premature ${twilioStatus} from parent leg of browser call: ${sid}`);
      return;
    }

    let { leadId, contactId, queueCardId } = metadata || ({} as any);
    if (!userId) userId = providedAgentId;

    if (!userId) {
      console.warn(`[handleCallStatusUpdate] No metadata and no providedAgentId for SID ${sid}. Cannot track status.`);
      return;
    }
    // Terminal statuses that should release locks and potentially trigger next calls
    const terminalStatuses = ["failed", "busy", "no-answer", "completed", "canceled"];
    const isTerminal = terminalStatuses.includes(twilioStatus);

    let dbStatus: LeadCallStatus = LeadCallStatus.CALLING;
    if (twilioStatus === "failed") dbStatus = LeadCallStatus.FAILED;
    else if (twilioStatus === "busy") dbStatus = LeadCallStatus.BUSY;
    else if (twilioStatus === "no-answer") dbStatus = LeadCallStatus.NO_ANSWER;
    else if (twilioStatus === "canceled") dbStatus = LeadCallStatus.FAILED;
    else if (twilioStatus === "completed") dbStatus = LeadCallStatus.CALLED;
    else if (twilioStatus === "ringing" || twilioStatus === "initiated" || twilioStatus === "in-progress" || twilioStatus === "answered") {
        dbStatus = LeadCallStatus.CALLING;
    }

    // Clear transcription logs for ALL terminal statuses to prevent memory leak
    if (isTerminal) {
      this.clearTranscriptionLogs(sid);
    }

    if (leadId) {
      await this.updateLeadStatusInDB(leadId, dbStatus);
    }

    // Update CallRecord in DB
    try {
      const callRecord = await (prisma.callRecord as any).findUnique({ where: { callSid: sid } });

      if (callRecord) {
        // AMD may have already classified this call as a machine (disposition
        // "MACHINE" / status "machine-detected") just before hanging it up. The
        // terminal call-status webhook that follows the hangup must NOT relabel it
        // as CALLED/NO_ANSWER — that corrupted machine calls in reporting and could
        // fire a CONTACT/NO_ANSWER folder action on a machine.
        const isMachineRecord =
          callRecord.disposition === "MACHINE" || callRecord.status === "machine-detected";

        const updateData: any = { status: isMachineRecord ? "machine-detected" : twilioStatus };

        if (isTerminal) {
          const endTime = new Date();
          const duration = callRecord.startTime
            ? Math.floor((endTime.getTime() - new Date(callRecord.startTime).getTime()) / 1000)
            : 0;
          updateData.endTime = endTime;
          updateData.sessionId = metadata?.sessionId;
          updateData.duration = duration;
          updateData.disposition = isMachineRecord ? "MACHINE" : dbStatus;
        }

        await (prisma.callRecord as any).update({
          where: { callSid: sid },
          data: updateData
        });
        console.log(`[handleCallStatusUpdate] Updated CallRecord status to ${updateData.status}${isTerminal ? ', duration: ' + updateData.duration + 's' : ''}`);

        // ── TASK 3B: Apply Disposition Folder Actions ──
        // Skip for machine-detected calls — they are neither a live contact nor a
        // missed human attempt, so they must not land in a CONTACT/NO_ANSWER folder.
        if (isTerminal && dbStatus && !isMachineRecord) {
            let mappingValue: string | null = null;
            if (dbStatus === LeadCallStatus.CALLED) mappingValue = "CONTACT";
            else if (dbStatus === LeadCallStatus.NO_ANSWER) mappingValue = "NO_ANSWER";
            else if (dbStatus === LeadCallStatus.FAILED) mappingValue = "NO_ANSWER"; // A technical failure is a missed attempt, NOT a bad number. Bad Number is only ever set manually by an admin/agent.
            else if (dbStatus === LeadCallStatus.BUSY) mappingValue = "NO_ANSWER"; // Map busy to No Answer for folder purposes if needed, or omit

            // Map the dbStatus string exactly if it matches.
            // NOTE: BAD_NUMBER, DNC_CONTACT, and DNC_NUMBER are intentionally excluded — those
            // suppress dialing permanently and must only ever be applied by a deliberate user
            // action (the dedicated mark-bad-number / dnc endpoints), never auto-applied here.
            if (!mappingValue) {
                const knownValues = ["CONTACT", "NO_ANSWER", "VOICEMAIL"];
                if (knownValues.includes(dbStatus as string)) {
                    mappingValue = dbStatus as string;
                }
            }

            if (mappingValue && (contactId || leadId)) {
                // Fire-and-forget: applying the disposition folder action is a
                // categorization side-effect (disposition lookup + applyDisposition
                // cascade — several DB round-trips). Awaiting it here delayed the
                // terminal handler from reaching processQueue, so a freed line sat
                // idle for that whole time. It must not gate dialing the next contact.
                const dispContactId = contactId || leadId;
                const dispCallRecordId = callRecord.id;
                void (async () => {
                    try {
                        const sysDisp = await (prisma.disposition as any).findFirst({
                            where: {
                                value: mappingValue,
                                systemSetting: { userId: userId }
                            }
                        });

                        if (sysDisp) {
                            const { DispositionService } = require('../systemSettings/dispositions/service');
                            await DispositionService.applyDisposition({
                                contactId: dispContactId,
                                dispositionId: sysDisp.id,
                                appliedById: userId,
                                source: 'CALL',
                                callRecordId: dispCallRecordId
                            });
                            console.log(`[handleCallStatusUpdate] Applied system disposition ${sysDisp.label} for CallRecord ${dispCallRecordId}`);
                        }
                    } catch (dispError: any) {
                        console.error(`[handleCallStatusUpdate] Failed to apply disposition action: ${dispError.message}`);
                    }
                })();
            }
        }
      }
    } catch (dbError: any) {
      console.error(`[handleCallStatusUpdate] ERROR: CallRecord update failed: ${dbError.message}`);
    }

    // ── POWER DIALER: Handle redials for failed/busy/overflow ──
    const maxAttempts = 3;
    const currentAttempts = metadata?.attempts || 1;

    if (isTerminal && userId && (leadId || contactId)) {
      // IMPORTANT: Do NOT trigger redials based on the child (agent browser) leg status.
      // When isChildLeg=true, a 'no-answer' means the agent's BROWSER didn't connect,
      // NOT that the customer hung up. The parent 'completed' event handles real teardown.
      if (!isChildLeg) {
        // 1. Redial on overflow (agent busy) — but never redial a machine-detected call
        const isMachineDetected = metadata?.status === 'machine-detected' ||
          (leadId && await this.isLeadMachineDetected(leadId));
        if (isMachineDetected) {
          console.log(`[handleCallStatusUpdate] Lead ${leadId || contactId} was machine-detected. Skipping redial.`);
        } else if (metadata?.status === 'callback') {
          console.log(`[handleCallStatusUpdate] Customer ${leadId || contactId} hung up while on hold. Ensuring redial.`);
          this.requeueLeadForRedial(userId, leadId, contactId, 2000, currentAttempts, queueCardId);
        }
        // 2. Redial on technical failure or no-answer (Power Dialer behavior)
        else if (["busy", "no-answer", "failed"].includes(twilioStatus)) {
          if (currentAttempts < maxAttempts) {
            console.log(`[handleCallStatusUpdate] Lead ${leadId || contactId} status '${twilioStatus}'. Requeueing for redial (Attempt ${currentAttempts + 1}/${maxAttempts})`);
            // Use a longer delay for these (30s) to not annoy customer immediately
            this.requeueLeadForRedial(userId, leadId, contactId, 30000, currentAttempts + 1, queueCardId);
          } else {
            console.log(`[handleCallStatusUpdate] Lead ${leadId || contactId} reached max attempts (${maxAttempts}). Stopping redials.`);
          }
        }
      } else {
        console.log(`[handleCallStatusUpdate] Skipping redial logic for child leg status '${twilioStatus}' on parent SID ${sid}.`);
      }
    }

    if (isTerminal) {
      // IMPORTANT: For child (agent browser) legs, only process lock release on 'completed' or 'canceled'.
      // A 'no-answer' or 'failed' on the child leg means the agent browser didn't connect,
      // but the parent call (customer) may still be alive. Releasing the lock here would
      // disconnect the customer. The parent's own terminal event handles real teardown.
      if (isChildLeg && !["completed", "canceled"].includes(twilioStatus)) {
        console.log(`[handleCallStatusUpdate] Child leg terminal '${twilioStatus}' on parent SID ${sid} — NOT releasing lock. Waiting for parent to complete.`);
        return;
      }

      if (this.processedTerminalSids.has(sid)) {
        console.log(`[handleCallStatusUpdate] Skipped redundant terminal trigger for SID ${sid}`);
        this.activeCalls.delete(sid);
        return;
      }
      this.processedTerminalSids.add(sid);
      
      // Clean up old SIDs from tracking every 100 calls to prevent memory leak
      if (this.processedTerminalSids.size > 200) {
        const oldestSids = Array.from(this.processedTerminalSids).slice(0, 50);
        oldestSids.forEach(s => this.processedTerminalSids.delete(s));
      }

      const rootSid = this.sidToRootSid.get(sid) || sid;
      const lockOwner = (this as any).agentBridgedCallId.get(userId!);

      console.log(`[handleCallStatusUpdate] Call ${sid} (root: ${rootSid}, isChild: ${isChildLeg}) terminal: ${twilioStatus}. Lock Owner: ${lockOwner || 'NONE'}`);

      // Release agent busy lock ONLY if this specific SID or its ROOT is the lock owner
      if (lockOwner && (lockOwner === sid || lockOwner === rootSid)) {
        console.log(`[handleCallStatusUpdate] Releasing agent ${userId} lock owner match: ${lockOwner}.`);
        // A bridged call has ended → ALWAYS require the agent to pick a disposition
        // before the next call is dialed. `agentReadyState` (set by /calling/agent-ready
        // when the agent applies a disposition) must NOT be used to skip the post-call
        // pause here: it was set for the PREVIOUS call and leaks onto this one, which
        // caused the agent to be bridged to the next customer with no disposition prompt.
        // Clear it and always enter post-call; agentReady() lifts this state on demand.
        // Did the agent already pick a disposition for THIS call before its
        // terminal webhook arrived? If so, honor it and advance — do NOT re-arm
        // post-call (that race stranded the agent and forced a second click).
        // Matching on sid/rootSid keeps a stale ready from a PRIOR call from
        // leaking onto this one.
        const readyForSid = this.agentReadyForCall.get(userId!);
        const preDispositioned = !!readyForSid && (readyForSid === sid || readyForSid === rootSid);
        this.agentReadyForCall.delete(userId!);
        this.agentReadyState.delete(userId!);
        if (preDispositioned) {
          console.log(`[handleCallStatusUpdate] Agent ${userId} already dispositioned ${sid} before teardown. Advancing without re-entering post-call.`);
          this.agentPostCallState.delete(userId!);
          this.postCallEnteredAt.delete(userId!);
        } else {
          this.agentPostCallState.add(userId!);
        }
        this.setAgentBusy(userId!, false);
        this.agentBridgedCallId.delete(userId!);
        // Delete SID BEFORE processing queue so capacity is accurate
        this.activeCalls.delete(sid);
      } else {
        console.log(`[handleCallStatusUpdate] Non-locking leg terminated. Checking for orphaned lock...`);
        const hasOtherCalls = Array.from(this.activeCalls.entries()).some(([callSid, metadata]) => 
          metadata.userId === userId && 
          callSid !== sid &&
          metadata.status && 
          !terminalStatuses.includes(metadata.status)
        );
        
        if (!hasOtherCalls && userId && this.isAgentBusy(userId)) {
           console.log(`[handleCallStatusUpdate] No other active calls for ${userId}. Clearing stuck lock.`);
           // Same rule as the lock-owner branch above: always enter post-call so the
           // agent must disposition before the queue advances. Never let a stale
           // `agentReadyState` from a prior call skip this gate.
           this.agentReadyState.delete(userId);
           this.agentPostCallState.add(userId);
           this.setAgentBusy(userId, false);
           this.agentBridgedCallId.delete(userId);
           // Delete SID BEFORE processing queue so capacity is accurate
           this.activeCalls.delete(sid);
        } else {
           // Ensure deletion even if we didn't release a lock
           this.activeCalls.delete(sid);
        }
      }

      // Re-pump the queue after ANY terminal call so a freed pacing slot is
      // refilled immediately. Without this, a non-bridged leg that ends as
      // no-answer/busy/failed/completed (the common power-dialer case where the
      // customer never picks up) deletes its SID but never dials the next lead —
      // the queue starves with calls left "ringing" until the agent abandons the
      // session. processQueue() self-guards on post-call state, agent-busy, and
      // the per-user processing lock, so this is a no-op while the agent is still
      // on a live call or owes a disposition; it only advances when there is
      // genuinely free capacity.
      this.processQueue(userId);
    }
  }

  async handleRecordingUpdate(callSid: string, recordingUrl: string, RecordingSid: string, ctx?: { contactId?: string; leadId?: string }) {
    try {
      console.log(`[Recording] Updating for ${callSid}: ${recordingUrl}`);

      if (!envConfig.R2_ACCOUNT_ID) {
        console.warn("[Recording] R2 not configured. Skipping recording sync.");
        return;
      }

      // 1. Download from Twilio
      const downloadUrl = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;
      const response = await axios<ArrayBuffer>({
        url: downloadUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        auth: {
          username: envConfig.TWILIO_ACCOUNT_SID!,
          password: envConfig.TWILIO_AUTH_TOKEN!
        }
      });
      const audioBuffer = Buffer.from(response.data);

      // 2. Upload to R2
      const r2Result = await uploadToR2(audioBuffer, 'audio/mpeg', 'call-recordings');
      const r2Url = r2Result.url;

      // RESOLVE the CallRecord this recording belongs to. Prefer an exact SID
      // match; then the parent SID; then the lead/contact passed in the callback
      // URL. The last two cover the power-dialer bridge case, where the recording's
      // CallSid is a child leg that has no CallRecord of its own — SID-only
      // matching was silently dropping those recordings.
      let callRecord = await prisma.callRecord.findUnique({ where: { callSid } });
      if (!callRecord) {
        const root = this.sidToRootSid.get(callSid);
        if (root) {
          console.log(`[Recording] Resolving child SID ${callSid} to root ${root}`);
          callRecord = await prisma.callRecord.findUnique({ where: { callSid: root } });
        }
      }
      if (!callRecord && ctx?.leadId) {
        callRecord = await prisma.callRecord.findFirst({
          where: { leadId: ctx.leadId },
          orderBy: { startTime: "desc" },
        });
      }
      if (!callRecord && ctx?.contactId) {
        callRecord = await prisma.callRecord.findFirst({
          where: { contactId: ctx.contactId, recordingUrl: null },
          orderBy: { startTime: "desc" },
        });
      }

      if (!callRecord) {
        console.warn(`[Recording] No CallRecord found for SID ${callSid} (lead=${ctx?.leadId || "-"}, contact=${ctx?.contactId || "-"}). Recording NOT attached.`);
        return;
      }

      // Save the recording URL FIRST, so a later transcription failure can never
      // cause the recording to be lost.
      await prisma.callRecord.update({
        where: { id: callRecord.id },
        data: { recordingUrl: r2Url },
      });
      console.log(`[R2] Recording saved to CallRecord ${callRecord.id} (callSid ${callRecord.callSid}): ${r2Url}`);

      // 3. Transcription + sentiment are best-effort — never let a failure here
      //    undo the recording attachment above.
      try {
        const audioFile = new File([audioBuffer], `recording-${callSid}.mp3`, { type: 'audio/mpeg' });
        const transcription = await groq.audio.transcriptions.create({
          file: audioFile,
          model: "whisper-large-v3",
          temperature: 0,
          response_format: "verbose_json",
        }) as any;

        let richTranscript: string;
        if (transcription.segments && Array.isArray(transcription.segments) && transcription.segments.length > 0) {
          richTranscript = transcription.segments
            .map((seg: any) => {
              const start = Math.floor(seg.start ?? 0);
              const mm = String(Math.floor(start / 60)).padStart(2, "0");
              const ss = String(start % 60).padStart(2, "0");
              return `[${mm}:${ss}] ${(seg.text ?? "").trim()}`;
            })
            .join("\n");
        } else {
          richTranscript = transcription.text ?? "";
        }

        const sentimentAnalysis = await this.analyzeSentiment(richTranscript);

        const leadInterest = String(sentimentAnalysis?.lead_interest || "none").toLowerCase();
        const callOutcome = String(sentimentAnalysis?.call_outcome || "no_meaningful_conversation").toLowerCase();
        const complianceFlags = Array.isArray(sentimentAnalysis?.compliance_flags)
          ? sentimentAnalysis.compliance_flags.map((f: any) => String(f)).filter(Boolean)
          : [];
        const riskPhrases = Array.isArray(sentimentAnalysis?.risk_phrases)
          ? sentimentAnalysis.risk_phrases.map((p: any) => String(p)).filter(Boolean)
          : [];
        const objections = Array.isArray(sentimentAnalysis?.objections)
          ? sentimentAnalysis.objections.map((o: any) => String(o)).filter(Boolean)
          : [];

        await prisma.callAnalysis.upsert({
          where: { callSid: callRecord.callSid },
          update: {
            recordingUrl: r2Url,
            sentiment: sentimentAnalysis?.sentiment || "neutral",
            confidence: sentimentAnalysis?.confidence || 0,
            leadInterest,
            callOutcome,
            complianceFlags,
            riskPhrases,
            objections,
            aiSummary: buildAiSummary(sentimentAnalysis),
            transcript: richTranscript || transcription.text
          },
          create: {
            callSid: callRecord.callSid,
            leadId: callRecord.leadId || "",
            recordingUrl: r2Url,
            sentiment: sentimentAnalysis?.sentiment || "neutral",
            confidence: sentimentAnalysis?.confidence || 0,
            leadInterest,
            callOutcome,
            complianceFlags,
            riskPhrases,
            objections,
            aiSummary: buildAiSummary(sentimentAnalysis),
            transcript: richTranscript || transcription.text
          }
        });
      } catch (txErr: any) {
        console.error(`[Recording] Transcription/sentiment failed (recording still saved): ${txErr?.message}`);
      }
    } catch (error) {
      console.error("Failed to handle recording update:", error);
    }
  }

  private async uploadRecordingToR2(twilioUrl: string, callSid: string): Promise<string> {
    try {
      const downloadUrl = twilioUrl.endsWith('.mp3') ? twilioUrl : `${twilioUrl}.mp3`;

      const response = await axios<ArrayBuffer>({
        url: downloadUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        auth: {
          username: envConfig.TWILIO_ACCOUNT_SID!,
          password: envConfig.TWILIO_AUTH_TOKEN!
        }
      });

      const buffer = Buffer.from(response.data);
      const r2Result = await uploadToR2(buffer, 'audio/mpeg', 'call-recordings');

      return r2Result.url;
    } catch (err) {
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

  // Returns true if the agent is in post-call disposition state (must not accept new bridges)
  public isAgentInPostCall(userId: string): boolean {
    return this.agentPostCallState.has(userId);
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
    if (busy) {
      this.lastActivity.set(userId, Date.now());
    }
    console.log(`[AgentState] User ${userId} busy state set to: ${busy}`);
    if (!busy && !this.agentPostCallState.has(userId)) {
      this.processQueue(userId);
    }
  }

  isAgentBusy(userId: string): boolean {
    const isBusy = this.agentBusyState.get(userId) || false;

    // STALE LOCK PROTECTION: Release if no activity for 60 minutes
    if (isBusy) {
      const last = this.lastActivity.get(userId) || 0;
      if (Date.now() - last > 60 * 60 * 1000) {
        console.warn(`[DialerService] Detected STALE LOCK for user ${userId}. Force releasing.`);
        this.setAgentBusy(userId, false);
        return false;
      }
    }

    return isBusy;
  }

  /**
   * Requeue a lead for a redial with its sticky Caller ID preserved.
   * Called when an overflow call (agent busy) needs a second attempt.
   * @param userId - the agent's user ID
   * @param contactId - the frontend contact ID (used as key in queue and sticky map)
   * @param delayMs - milliseconds to wait before reinserting (default 15s)
   */
  requeueLeadForRedial(userId: string, leadId: string, contactId: string, delayMs = 15_000, attempts = 1, queueCardId?: string) {
    // Add to pending redials guard
    if (!this.pendingRedials.has(userId)) this.pendingRedials.set(userId, new Set());
    
    const userRedials = this.pendingRedials.get(userId)!;
    const guardKey = queueCardId || contactId || leadId;

    if (userRedials.has(guardKey)) {
      console.log(`[DialerService] Redial already pending for ${guardKey}, skipping duplicate timer.`);
      return;
    }
    
    console.log(`[DialerService] Scheduling redial for lead ${leadId} (contact: ${contactId}) in ${delayMs}ms. Attempts so far: ${attempts}`);
    userRedials.add(guardKey);

    const timerKey = `${userId}:${guardKey}`;
    const timer = setTimeout(async () => {
      this.redialTimers.delete(timerKey);
      try {
        // If AMD detected this as a machine during the delay window, don't re-queue
        const currentLead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (currentLead?.status === 'MACHINE') {
          console.log(`[DialerService] Lead ${leadId} was machine-detected during redial delay. Skipping re-queue.`);
          this.pendingRedials.get(userId)?.delete(guardKey);
          return;
        }

        // Mark as CALL_BACK status in DB for UI amber color
        await this.updateLeadStatusInDB(leadId, "CALL_BACK");

        // Look up the lead record
        const lead = await prisma.lead.findUnique({
          where: { id: leadId }
        });

        if (lead) {
          const queue = this.getOrCreateQueue(userId);
          queue.enqueue({
            id: lead.id,
            fullName: lead.fullName,
            phone: lead.phone,
            // High priority so it jumps to the front of the queue
            priority: 999,
            userId: lead.userId,
            originalContactId: contactId,
            queueCardId: queueCardId || contactId || leadId,
            isRedial: true,
            attempts: attempts,
          });
          console.log(`[DialerService] Lead ${lead.id} requeued for redial (Attempt ${attempts}).`);
          
          // MOVED: Removal from guard now happens inside makeCall after the new call is active.
          // This ensures pendingRedialsCount stays > 0 during the async gap of makeCall.
          
          this.processQueue(userId);
        } else {
          // Lead is gone from DB, we MUST remove it now to avoid stale entry
          this.pendingRedials.get(userId)?.delete(guardKey);
          console.warn(`[DialerService] requeueLeadForRedial: lead not found for contactId ${contactId}`);
        }
      } catch (e) {
        console.error('[DialerService] Failed to requeue lead for redial:', e);
      }
    }, delayMs);

    this.redialTimers.set(timerKey, timer);
  }

  /**
   * Cancels a pending redial outright — clears the scheduled timer AND removes the
   * guard key. Used when AMD detects a machine so a redial that was scheduled by a
   * racing call-status webhook never fires (the DB-MACHINE check alone loses the race).
   */
  cancelPendingRedial(userId: string, guardKey: string) {
    if (!guardKey) return;
    const timerKey = `${userId}:${guardKey}`;
    const timer = this.redialTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.redialTimers.delete(timerKey);
      console.log(`[DialerService] Cancelled pending redial timer for ${timerKey}.`);
    }
    this.pendingRedials.get(userId)?.delete(guardKey);
  }

  /** @deprecated Use requeueLeadForRedial instead */
  recycleLeadWithDelay(userId: string, leadId: string) {
    this.requeueLeadForRedial(userId, leadId, leadId);
  }

  // Session Management
  setActiveSession(userId: string, sessionId: string) {
    this.userActiveSessions.set(userId, sessionId);
  }

  clearActiveSession(userId: string) {
    this.userActiveSessions.delete(userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECONCILIATION WATCHDOG (Layer 1)
  //
  // The dialer's state machine is driven by Twilio webhooks. If any webhook is
  // lost, delayed, duplicated, or arrives out of order, a session can wedge:
  // calls stuck "ringing", an agent lock never released, or the queue simply not
  // advancing. This loop treats Twilio's REST API as the source of truth and
  // reconciles our in-memory state against it on a fixed cadence, so the dialer
  // makes forward progress even when webhook delivery is unreliable.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Start the reconciliation watchdog. Call once at server boot. Idempotent. */
  startReconciliationLoop() {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => {
      this.reconcileAll().catch((err) =>
        console.error("[Reconcile] loop error:", err?.message)
      );
    }, DialerService.RECONCILE_INTERVAL_MS);
    console.log(
      `[Reconcile] Watchdog started (every ${DialerService.RECONCILE_INTERVAL_MS / 1000}s).`
    );
  }

  /** All userIds that currently hold any active dialer state. */
  private getActiveUserIds(): Set<string> {
    const ids = new Set<string>();
    for (const [uid, q] of this.userQueues) if (!q.isEmpty()) ids.add(uid);
    for (const c of this.activeCalls.values()) if (c.userId) ids.add(c.userId);
    for (const uid of this.agentBridgedCallId.keys()) ids.add(uid);
    for (const uid of this.agentPostCallState) ids.add(uid);
    for (const [uid, s] of this.leadsInFlight) if (s.size) ids.add(uid);
    for (const [uid, s] of this.pendingRedials) if (s.size) ids.add(uid);
    // Never act on users who have explicitly stopped their session.
    for (const uid of this.stoppedUsers) ids.delete(uid);
    return ids;
  }

  private async reconcileAll() {
    // Prune last-seen tracking for calls that are no longer active (avoid growth).
    for (const sid of this.sidLastStatusAt.keys()) {
      if (!this.activeCalls.has(sid)) this.sidLastStatusAt.delete(sid);
    }
    // Drop post-call timers for users no longer in post-call.
    for (const uid of this.postCallEnteredAt.keys()) {
      if (!this.agentPostCallState.has(uid)) this.postCallEnteredAt.delete(uid);
    }

    for (const userId of this.getActiveUserIds()) {
      try {
        await this.reconcileUser(userId);
      } catch (err: any) {
        console.error(`[Reconcile] user ${userId} failed:`, err?.message);
      }
    }
  }

  private async reconcileUser(userId: string) {
    const now = Date.now();
    const terminal = ["completed", "busy", "no-answer", "failed", "canceled"];

    // Collect this user's tracked call SIDs up front.
    const sids: string[] = [];
    for (const [sid, meta] of this.activeCalls.entries()) {
      if (meta.userId === userId) sids.push(sid);
    }

    // 1. Reconcile each tracked call against Twilio truth. Only fetch calls we
    //    haven't heard about recently, to keep API usage minimal.
    let client: any = null;
    for (const sid of sids) {
      const lastSeen = this.sidLastStatusAt.get(sid) ?? 0;
      if (now - lastSeen < DialerService.CALL_STALE_MS) continue;
      try {
        if (!client) client = await getTwilioClient(userId);
        const call = await client.calls(sid).fetch();
        // Refresh so we don't re-query a still-live call every tick.
        this.sidLastStatusAt.set(sid, Date.now());
        const status = (call?.status || "").toLowerCase();
        if (terminal.includes(status)) {
          console.warn(
            `[Reconcile] Twilio reports ${sid}='${status}' but it was still tracked for user ${userId}. Applying terminal transition (missed webhook).`
          );
          await this.handleCallStatusUpdate(sid, status, false, userId);
        }
      } catch (err: any) {
        // 20404 / 404 = call no longer exists on Twilio → treat as completed so
        // we release any lock/slot it was holding.
        if (err?.status === 404 || err?.code === 20404) {
          console.warn(
            `[Reconcile] Call ${sid} not found on Twilio for user ${userId}. Treating as completed.`
          );
          await this.handleCallStatusUpdate(sid, "completed", false, userId);
        } else {
          console.error(`[Reconcile] fetch ${sid} failed:`, err?.message);
        }
      }
    }

    // 2. Orphaned agent lock: the lock is held but the lock-owning call is no
    //    longer tracked (its terminal was already processed) → release it so the
    //    queue can advance.
    const lockSid = this.agentBridgedCallId.get(userId);
    if (lockSid && !this.activeCalls.has(lockSid) && this.isAgentBusy(userId)) {
      console.warn(
        `[Reconcile] Agent ${userId} lock ${lockSid} is orphaned (call no longer tracked). Releasing.`
      );
      this.setAgentBusy(userId, false);
      this.agentBridgedCallId.delete(userId);
    }

    // 3. Abandoned post-call: the agent is parked in post-call with no live call
    //    beyond the grace window (their /agent-ready never arrived). Clear it so
    //    the session resumes instead of freezing until the 60-min stale TTL.
    if (this.agentPostCallState.has(userId)) {
      const enteredAt = this.postCallEnteredAt.get(userId);
      if (enteredAt === undefined) {
        this.postCallEnteredAt.set(userId, now); // start the clock on first observation
      } else {
        const hasLiveCall = sids.some((sid) => {
          const st = this.activeCalls.get(sid)?.status;
          return st !== undefined && !terminal.includes(st);
        });
        if (!hasLiveCall && now - enteredAt > DialerService.POSTCALL_GRACE_MS) {
          console.warn(
            `[Reconcile] Agent ${userId} abandoned in post-call for >${DialerService.POSTCALL_GRACE_MS / 1000}s with no live calls. Clearing to resume.`
          );
          this.agentPostCallState.delete(userId);
          this.postCallEnteredAt.delete(userId);
        }
      }
    }

    // 4. Forward-progress safety net: if there is free capacity, leads waiting,
    //    and the agent is neither busy nor owed a disposition, pump the queue.
    //    This guarantees the dialer advances even if every webhook were lost.
    const queue = this.userQueues.get(userId);
    if (
      queue &&
      !queue.isEmpty() &&
      !this.isAgentBusy(userId) &&
      !this.agentPostCallState.has(userId)
    ) {
      this.processQueue(userId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVABILITY (Layer 3)
  // Rich, on-demand snapshot of one user's live dialer state so a stuck session
  // can be inspected directly instead of grepping interleaved multi-user logs.
  // ═══════════════════════════════════════════════════════════════════════════
  getDebugState(userIdRaw: string) {
    const userId = userIdRaw?.toString().trim();
    const now = Date.now();

    const activeCalls = Array.from(this.activeCalls.entries())
      .filter(([, m]) => m.userId?.toString().trim() === userId)
      .map(([sid, m]) => ({
        sid,
        status: m.status ?? null,
        leadId: m.leadId ?? null,
        contactId: m.contactId ?? null,
        isRedial: !!m.isRedial,
        attempts: m.attempts ?? null,
        lastStatusAgeMs: this.sidLastStatusAt.has(sid)
          ? now - this.sidLastStatusAt.get(sid)!
          : null,
      }));

    const queue = this.userQueues.get(userId);
    const freeze = this.callerIdFreezeState.get(userId);

    return {
      userId,
      queueSize: queue?.size() ?? 0,
      isAgentBusy: this.agentBusyState.get(userId) ?? false,
      lockOwnerSid: this.agentBridgedCallId.get(userId) ?? null,
      isPostCall: this.agentPostCallState.has(userId),
      postCallForMs: this.postCallEnteredAt.has(userId)
        ? now - this.postCallEnteredAt.get(userId)!
        : null,
      isReady: this.agentReadyState.has(userId),
      isProcessing: this.userProcessingLocks.get(userId) ?? false,
      isStopped: this.stoppedUsers.has(userId),
      pacing: this.sessionPacing.get(userId) ?? null,
      lastActivityAgeMs: this.lastActivity.has(userId)
        ? now - this.lastActivity.get(userId)!
        : null,
      activeCalls,
      inFlightLeadIds: Array.from(this.leadsInFlight.get(userId) ?? []),
      pendingRedials: Array.from(this.pendingRedials.get(userId) ?? []),
      callerIdPool: this.userCallerIdPools.get(userId) ?? [],
      frozenCallerIds: Object.fromEntries(
        Array.from(freeze?.entries() ?? []).filter(([, ms]) => ms > now)
      ),
      reconcileWatchdog: this.reconcileTimer ? "running" : "stopped",
    };
  }
}

export const dialerService = DialerService.getInstance();
