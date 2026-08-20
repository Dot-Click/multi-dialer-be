import prisma from "@/lib/prisma";
import type { SessionRow } from "../../domain/prospecting";
import { ProspectingStage } from "@prisma/client";

/**
 * This file is the application-layer equivalent of BUILD_SPEC.md's
 * `v_prospecting_calls_daily` + `v_prospecting_stages_daily` + `v_prospecting_daily`
 * — the ONE place the tracker touches the dialer/CRM schema. There is no SQL
 * view because this project has no per-call "connected" flag or "source"
 * column on calls; the equivalent facts already live across three tables,
 * so the join happens here instead of in Postgres.
 *
 * Field mapping decisions (none of these existed as an explicit tracker
 * contract before this file — recorded here so they're easy to revisit):
 *   - Hours    <- AgentSession.duration (seconds), grouped by day.
 *   - Source   <- AgentSession.listId for dialer-derived rows (BUILD_SPEC's
 *                 contract calls this "calling list / campaign", which is
 *                 exactly what listId already is).
 *   - Contacts <- CallRecord.dispositionId where the disposition is "CONTACT",
 *                 i.e. the Contacted outcome pushed on an actual call.
 *                 See the block comment below — this deliberately does NOT
 *                 use ContactDispositionLog.
 *   - Funnel stages (leads..closed) + GCI <- ProspectingStageEvent, which is
 *                 itself written whenever one of the six funnel Dispositions
 *                 is applied (see systemSettings/dispositions/service.ts).
 *
 * Day boundaries are UTC-midnight pending the Timezone open question in
 * BUILD_SPEC.md §7 (Company.defaultTimeZone exists but isn't yet threaded
 * through every write path that can produce a day bucket).
 */

const DAY_MS = 86_400_000;

/** Disposition.value that means "I actually spoke to this person". */
const CONTACTED_DISPOSITION_VALUE = "CONTACT";

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive day range as UTC instants, for Prisma `gte`/`lt` filters. */
function dayRangeFilter(fromIso: string, toIso: string): { gte: Date; lt: Date } {
  return {
    gte: new Date(fromIso + "T00:00:00.000Z"),
    lt: new Date(new Date(toIso + "T00:00:00.000Z").getTime() + DAY_MS),
  };
}

function emptyRow(loggedOn: string, source: string | null): SessionRow {
  return {
    loggedOn,
    source,
    hours: 0,
    contacts: 0,
    leads: 0,
    apptsSet: 0,
    apptsMet: 0,
    listingsTaken: 0,
    underContract: 0,
    closed: 0,
    gci: 0,
  };
}

const STAGE_FIELD: Record<ProspectingStage, keyof SessionRow> = {
  LEAD: "leads",
  APPT_SET: "apptsSet",
  APPT_MET: "apptsMet",
  LISTING_TAKEN: "listingsTaken",
  UNDER_CONTRACT: "underContract",
  CLOSED: "closed",
};

/** Merge key: a day bucket is unique per (day, source). Null source is its own bucket. */
function bucketKey(loggedOn: string, source: string | null): string {
  return `${loggedOn}::${source ?? ""}`;
}

/**
 * Builds the merged daily SessionRow[] for one user over an inclusive date
 * range — dialer + CRM derived rows, with any ProspectingSession override
 * winning wholesale for the (day, source) buckets it covers. Feed the result
 * into the domain layer's aggregateSessions/computeActualKpis/computeStreak —
 * it has no opinion on where the numbers came from.
 */
export async function getDailyRows(
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<SessionRow[]> {
  const range = dayRangeFilter(fromIso, toIso);
  const derived = new Map<string, SessionRow>();

  const getOrCreate = (loggedOn: string, source: string | null): SessionRow => {
    const key = bucketKey(loggedOn, source);
    let row = derived.get(key);
    if (!row) {
      row = emptyRow(loggedOn, source);
      derived.set(key, row);
    }
    return row;
  };

  // ---- Hours, from dialer sessions -----------------------------------
  const agentSessions = await prisma.agentSession.findMany({
    where: { userId, startTime: range },
    select: { startTime: true, duration: true, listId: true },
  });
  for (const s of agentSessions) {
    const row = getOrCreate(toIsoDay(s.startTime), s.listId ?? null);
    row.hours += (s.duration ?? 0) / 3600;
  }

  // ---- Contacts, from the Contacted outcome on an actual call ---------
  //
  // Deliberately CallRecord, not ContactDispositionLog.
  //
  // ContactDispositionLog records every application of a disposition to a
  // contact, whatever the route: bulk list actions, imports, manual
  // re-tagging from the contact detail screen. On live that produced 3,133
  // "contacts" against 22.6 hours — 138 per hour, one every 26 seconds,
  // which is not a conversation rate. It made every downstream ratio
  // meaningless: contact->lead read 0.0% purely because the denominator was
  // inflated by an order of magnitude.
  //
  // CallRecord.dispositionId is only written when a disposition is chosen as
  // the outcome of a real call, which is exactly the contract: a contact is
  // counted when the Contacted outcome is pushed on the dialer, or when the
  // agent enters one by hand in the Log activity form (handled by the
  // override merge at the bottom of this function).
  const contactCalls = await prisma.callRecord.findMany({
    where: {
      userId,
      createdAt: range,
      dispositionRef: { value: CONTACTED_DISPOSITION_VALUE },
    },
    select: {
      createdAt: true,
      session: { select: { listId: true } },
    },
  });
  for (const call of contactCalls) {
    // Attribute to the calling list the call belonged to, so contacts land in
    // the same channel bucket as the hours that produced them. Calls with no
    // session (rare — manual dials outside a session) fall to null source,
    // same as before.
    const row = getOrCreate(toIsoDay(call.createdAt), call.session?.listId ?? null);
    row.contacts += 1;
  }

  // ---- Funnel stages + GCI, from stage events -------------------------
  const stageEvents = await prisma.prospectingStageEvent.findMany({
    where: { userId, occurredOn: range },
    select: { occurredOn: true, source: true, stage: true, gci: true },
  });
  for (const ev of stageEvents) {
    const row = getOrCreate(toIsoDay(ev.occurredOn), ev.source ?? null);
    const field = STAGE_FIELD[ev.stage];
    (row[field] as number) += 1;
    if (ev.stage === "CLOSED") {
      row.gci += Number(ev.gci);
    }
  }

  // ---- Manual overrides — win wholesale per (day, source) -------------
  const overrides = await prisma.prospectingSession.findMany({
    where: { userId, loggedOn: range },
  });

  const merged = new Map<string, SessionRow>(derived);
  for (const o of overrides) {
    const loggedOn = toIsoDay(o.loggedOn);
    merged.set(bucketKey(loggedOn, o.source), {
      loggedOn,
      source: o.source,
      hours: Number(o.hours),
      contacts: o.contacts,
      leads: o.leads,
      apptsSet: o.apptsSet,
      apptsMet: o.apptsMet,
      listingsTaken: o.listingsTaken,
      underContract: o.underContract,
      closed: o.closed,
      gci: Number(o.gci),
      notes: o.notes,
    });
  }

  return [...merged.values()];
}
