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
 *   - Contacts <- the FIRST application of the "CONTACT" disposition to each
 *                 contact, on or after CONTACTS_COUNTED_FROM. One press, one
 *                 contact, once ever. See the block comment below — this
 *                 counts distinct contacts, not log rows, and deliberately
 *                 does NOT use CallRecord.
 *   - Funnel stages (leads..closed) + GCI <- ProspectingStageEvent, which is
 *                 itself written whenever one of the six funnel Dispositions
 *                 is applied (see systemSettings/dispositions/service.ts).
 *
 * Day boundaries are UTC-midnight pending the Timezone open question in
 * BUILD_SPEC.md §7 (Company.defaultTimeZone is settable as of the compliance
 * timezone change, but is not yet threaded through the day bucketing here).
 */

const DAY_MS = 86_400_000;

/** Disposition.value that means "I actually spoke to this person". */
const CONTACTED_DISPOSITION_VALUE = "CONTACT";

/**
 * Contacts are counted from this date forward and no earlier.
 *
 * ContactDispositionLog cannot distinguish a Contacted button press from a
 * bulk list action, an import, or a re-tag — they all write the same row.
 * That ambiguity is what produced 3,133 "contacts" against 22.6 hours before
 * this was reworked. Counting first-press-per-contact fixes the rate going
 * forward, but walking the same log backwards still inherits whatever those
 * bulk operations left behind, spread across dates nobody can audit.
 *
 * So the history is not carried. Days before this read zero contacts, which
 * is at least a statement the page can explain, rather than a plausible
 * number that is quietly wrong.
 *
 * Exported so the API can disclose it: a zero because nothing was measured
 * and a zero because nothing happened must never render the same.
 */
export const CONTACTS_COUNTED_FROM = "2026-08-21";

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

  // ---- Contacts: first press of Contacted, per contact, once ever -----
  //
  // The rule: one press of the Contacted button on a contact is one contact.
  // Inside or outside a dialer session, no distinction. However many times
  // that person is called, still one. Once ever — reaching them again next
  // month does not count again. Identical semantics to Lead.
  //
  // Counting the FIRST application per contact rather than log rows is what
  // makes that true. ContactDispositionLog writes a row on every application,
  // by every route — bulk list actions, imports, manual re-tagging, and the
  // dialer pressing the same button twice on one call (which the live logs
  // show happening routinely). Counting rows gave 3,133 contacts against 22.6
  // hours: 138 an hour, one every 26 seconds, which is not a conversation
  // rate, and it dragged contact->lead down to 0.0% purely by inflating the
  // denominator. Collapsing to MIN(createdAt) per contact removes all of it —
  // a second application of the same tag can never add to the count.
  //
  // Deliberately NOT CallRecord.dispositionId, which the previous fix used.
  // That column is only written when applyDisposition is called with a
  // callRecordId, and the frontend has never sent one — the identifier does
  // not appear anywhere in slingvo-fe. It read as near-zero.
  //
  // Floored at CONTACTS_COUNTED_FROM so the old, unauditable history is not
  // carried forward. See that constant.
  //
  // Bucketed to a null source: a contact can be recorded with no dialer
  // session running, so there is no calling list to attribute it to.
  const contactsFloor = new Date(CONTACTS_COUNTED_FROM + "T00:00:00.000Z");
  const contactsFrom = range.gte > contactsFloor ? range.gte : contactsFloor;

  if (contactsFrom < range.lt) {
    const contactDays = await prisma.$queryRaw<Array<{ day: string; contacts: number }>>`
      SELECT to_char(f.first_at::date, 'YYYY-MM-DD') AS day,
             COUNT(*)::int                           AS contacts
      FROM (
        SELECT l."contactId", MIN(l."createdAt") AS first_at
        FROM contact_disposition_logs l
        JOIN dispositions d ON d.id = l."dispositionId"
        WHERE l."appliedById" = ${userId}
          AND d.value = ${CONTACTED_DISPOSITION_VALUE}
        GROUP BY l."contactId"
      ) f
      WHERE f.first_at >= ${contactsFrom} AND f.first_at < ${range.lt}
      GROUP BY 1 ORDER BY 1`;
    for (const r of contactDays) {
      getOrCreate(r.day, null).contacts += Number(r.contacts);
    }
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
