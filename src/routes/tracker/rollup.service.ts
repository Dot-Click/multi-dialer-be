import prisma from "@/lib/prisma";
import type { SessionRow } from "../../domain/prospecting";
import { ProspectingStage } from "@prisma/client";
import { startOfDayInTimeZone, endOfDayExclusiveInTimeZone } from "../../utils/timezone";

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
 *                 contact since CONTACTS_COUNTED_FROM. One press, one
 *                 contact, once ever. See the block comment below — this
 *                 counts distinct contacts, not log rows, and deliberately
 *                 does NOT use CallRecord.
 *   - Funnel stages (leads..closed) + GCI <- ProspectingStageEvent, which is
 *                 itself written whenever one of the six funnel Dispositions
 *                 is applied (see systemSettings/dispositions/service.ts).
 *   - Manual entries <- ProspectingSession, ADDED on top of all of the above.
 *                 See the merge at the bottom.
 *
 * Days are bucketed in the TENANT'S timezone (Company.defaultTimeZone — the
 * same value TCPA windows are evaluated against), not UTC. See the two range
 * kinds in getDailyRows: TIMESTAMP and DATE columns need different treatment
 * and mixing them up puts activity on the wrong day.
 */

/** Disposition.value that means "I actually spoke to this person". */
export const CONTACTED_DISPOSITION_VALUE = "CONTACT";

/**
 * Contacts are counted from this INSTANT forward and no earlier.
 *
 * Until 2026-08-22 the dialer auto-applied this disposition on every call
 * that reached Twilio's "completed" status — an uncaught voicemail, a
 * two-second wrong number, a pickup and an immediate hangup. Those rows are
 * identical in every column to an agent pressing the Contacted button, so
 * there is no way to tell them apart after the fact. They are the reason the
 * tracker read 3,133 contacts against 22.6 hours, and 68 on a day nobody
 * pressed the button 68 times.
 *
 * applyDisposition now refuses automatic CONTACT applications, so everything
 * written after this instant is a person's judgement. Everything before it is
 * unauditable and is not carried.
 *
 * An instant rather than a date on purpose: the rows this excludes were
 * written earlier the SAME calendar day as the presses it must include.
 *
 * Exported so the API can disclose it: a zero because nothing was measured
 * and a zero because nothing happened must never render the same.
 */
export const CONTACTS_COUNTED_FROM = "2026-08-22T13:00:00.000Z";

/**
 * The calendar day a DATE column already represents.
 *
 * Prisma hands back a @db.Date as a Date pinned to UTC midnight. It carries no
 * time and no zone — it IS the day. Passing it through a zone-aware reader
 * would resolve UTC midnight to the previous evening somewhere west of
 * Greenwich and report the day before. Read the UTC parts and stop.
 */
function toIsoDayUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
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

export interface DailyRowsResult {
  rows: SessionRow[];
  /** Sessions with no duration, no endTime and no finished calls — counted
   *  nowhere, so the UI can disclose them instead of quietly losing them. */
  excludedSessions: number;
}

/**
 * Builds the merged daily SessionRow[] for one user over an inclusive date
 * range — dialer + CRM derived rows, PLUS any manual entries the agent logged
 * for those (day, source) buckets. Feed the result into the domain layer's
 * aggregateSessions/computeActualKpis/computeStreak — it has no opinion on
 * where the numbers came from.
 *
 * `timeZone` is the tenant's IANA zone. Callers resolve it once and pass it
 * down rather than each query looking it up.
 */
export async function getDailyRows(
  userId: string,
  fromIso: string,
  toIso: string,
  timeZone: string,
): Promise<DailyRowsResult> {
  // TIMESTAMP columns: the UTC instants at which the local day starts and the
  // local day after the range ends starts.
  const instantRange = {
    gte: startOfDayInTimeZone(fromIso, timeZone),
    lt: endOfDayExclusiveInTimeZone(toIso, timeZone),
  };

  // DATE columns: no time, no zone, already a calendar day. Plain UTC midnight
  // bounds — shifting these by an offset would move the day.
  const dateRange = {
    gte: new Date(`${fromIso}T00:00:00.000Z`),
    lt: new Date(new Date(`${toIso}T00:00:00.000Z`).getTime() + 86_400_000),
  };

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
  // startTime is a TIMESTAMP, so the day it belongs to depends on the zone.
  //
  // duration is only written by endSession (calling/analytics.controller.ts),
  // and it writes endTime and duration together — so a session whose dialer
  // crashed, or whose tab was closed, has BOTH null and never gets either.
  // Counting those as 0 hours understated hours worked and silently inflated
  // every per-hour metric derived from it (contacts/hour, GCI/hour, leads/hour,
  // avg hours per day). Zero is the one answer that is definitely wrong.
  //
  // So fall back, in order of how much we trust it:
  //   1. duration            — the recorded length
  //   2. endTime - startTime — a clean end that somehow skipped duration
  //   3. last call's endTime - startTime — the session crashed, but we know it
  //      was live at least until its final call connected. A lower bound beats
  //      discarding a real three-hour session.
  // A session with none of the three is EXCLUDED rather than counted as zero,
  // and the count is returned so the UI can say so.
  // Bucketed and summed in Postgres: one row per (day, source) crosses the
  // wire instead of one row per session. The fallback ladder above is the
  // CASE below, in the same order.
  //
  // AT TIME ZONE twice is not a typo — same reason as the contacts query
  // further down: Prisma maps DateTime to timestamp WITHOUT time zone, so the
  // first call declares the stored value UTC and the second converts it to the
  // tenant's wall clock.
  const sessionDays = await prisma.$queryRaw<
    Array<{ day: string; source: string | null; seconds: number | null; excluded: number }>
  >`
    WITH s AS (
      SELECT
        to_char((a."startTime" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day,
        a."listId" AS source,
        CASE
          WHEN a."duration" IS NOT NULL
            THEN GREATEST(a."duration"::numeric, 0)
          WHEN a."endTime" IS NOT NULL
            THEN GREATEST(EXTRACT(EPOCH FROM (a."endTime" - a."startTime")), 0)
          WHEN lc.max_end IS NOT NULL
            THEN GREATEST(EXTRACT(EPOCH FROM (lc.max_end - a."startTime")), 0)
          ELSE NULL
        END AS seconds
      FROM agent_sessions a
      LEFT JOIN LATERAL (
        SELECT MAX(c."endTime") AS max_end
        FROM call_records c
        WHERE c."sessionId" = a.id AND c."endTime" IS NOT NULL
      ) lc ON TRUE
      WHERE a."userId" = ${userId}
        AND a."startTime" >= ${instantRange.gte}
        AND a."startTime" < ${instantRange.lt}
    )
    SELECT day,
           source,
           SUM(seconds)::float8                              AS seconds,
           COUNT(*) FILTER (WHERE seconds IS NULL)::int      AS excluded
    FROM s
    GROUP BY day, source`;

  let excludedSessions = 0;

  for (const r of sessionDays) {
    excludedSessions += Number(r.excluded);
    // seconds is NULL only when every session in this bucket was unusable.
    // Skip rather than creating a 0-hour bucket — a day that exists solely
    // because of excluded sessions was never a day the agent logged.
    if (r.seconds === null) continue;
    const row = getOrCreate(r.day, r.source ?? null);
    row.hours += Number(r.seconds) / 3600;
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
  // by every route, and collapsing to MIN(createdAt) per contact means a
  // second application can never add to the count.
  //
  // Deliberately NOT CallRecord.dispositionId. That column is only written
  // when applyDisposition is called WITH a callRecordId, which is now exactly
  // the automatic path this tracker must ignore — and the frontend has never
  // sent one, so it never reflected a button press at all.
  //
  // The floor is applied INSIDE the subquery, before the grouping. That is
  // the difference between "first press since the cutover" and "first press
  // ever, if that happened to fall after the cutover". The dialer spent
  // months auto-marking every completed call, so under the second reading
  // most of the database is permanently burned: press Contacted on one of
  // those people tomorrow and they still would not count, because their
  // first-ever row predates the cutover. Filtering before the group asks the
  // honest question instead — we distrust everything written before the
  // cutover, and within the window the once-ever rule is unchanged.
  //
  // AT TIME ZONE twice is not a typo. Prisma maps DateTime to timestamp(3)
  // WITHOUT time zone, so the first call declares "this naive value is UTC"
  // and the second converts it to the tenant's wall clock. One call alone
  // would read the stored value as already-local and be wrong by the offset.
  //
  // Bucketed to a null source: a contact can be recorded with no dialer
  // session running, so there is no calling list to attribute it to.
  const contactsFloor = new Date(CONTACTS_COUNTED_FROM);

  if (instantRange.lt > contactsFloor) {
    const contactDays = await prisma.$queryRaw<Array<{ day: string; contacts: number }>>`
      SELECT to_char((f.first_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS contacts
      FROM (
        SELECT l."contactId", MIN(l."createdAt") AS first_at
        FROM contact_disposition_logs l
        JOIN dispositions d ON d.id = l."dispositionId"
        WHERE l."appliedById" = ${userId}
          AND d.value = ${CONTACTED_DISPOSITION_VALUE}
          AND l."createdAt" >= ${contactsFloor}
        GROUP BY l."contactId"
      ) f
      WHERE f.first_at >= ${instantRange.gte} AND f.first_at < ${instantRange.lt}
      GROUP BY 1 ORDER BY 1`;
    for (const r of contactDays) {
      getOrCreate(r.day, null).contacts += Number(r.contacts);
    }
  }

  // ---- Funnel stages + GCI, from stage events -------------------------
  // occurredOn is a DATE — already the calendar day the stage was reached.
  // Grouped in Postgres — one row per (day, source, stage) rather than one per
  // event. occurredOn is a DATE, so to_char gives the day directly; no zone
  // conversion, for the reason in toIsoDayUTC above.
  const stageDays = await prisma.$queryRaw<
    Array<{ day: string; source: string | null; stage: ProspectingStage; n: number; gci: string }>
  >`
    SELECT to_char("occurredOn", 'YYYY-MM-DD')  AS day,
           "source"                             AS source,
           "stage"::text                        AS stage,
           COUNT(*)::int                        AS n,
           COALESCE(SUM("gci"), 0)::text        AS gci
    FROM prospecting_stage_events
    WHERE "userId" = ${userId}
      AND "occurredOn" >= ${dateRange.gte}
      AND "occurredOn" < ${dateRange.lt}
    GROUP BY 1, 2, 3`;

  for (const ev of stageDays) {
    const row = getOrCreate(ev.day, ev.source ?? null);
    const field = STAGE_FIELD[ev.stage];
    (row[field] as number) += Number(ev.n);
    if (ev.stage === "CLOSED") {
      row.gci += Number(ev.gci);
    }
  }

  // ---- Manual entries — ADDED to the bucket, never replacing it -------
  //
  // A manual entry is activity the system could not see: door knocking, an
  // open house, a conversation at the gym. It happened IN ADDITION to what
  // the dialer and CRM recorded, so it is a contribution to its (day, source)
  // bucket, not a substitute for one.
  //
  // This used to overwrite the bucket wholesale — every field taken from the
  // manual row — which erased the derived numbers rather than adding to them.
  // Worse, the fields left at zero in the form erased too: logging two hours
  // of door knocking zeroed that day's contacts, leads and appointments along
  // with its dialer hours.
  //
  // A bucket with no derived activity starts from an empty row, so a purely
  // manual day still reads exactly what was entered.
  //
  // loggedOn is a DATE column, same as occurredOn above.
  const manualEntries = await prisma.prospectingSession.findMany({
    where: { userId, loggedOn: dateRange },
  });

  const merged = new Map<string, SessionRow>(derived);
  for (const m of manualEntries) {
    const loggedOn = toIsoDayUTC(m.loggedOn);
    const key = bucketKey(loggedOn, m.source);
    const base = merged.get(key) ?? emptyRow(loggedOn, m.source);

    merged.set(key, {
      loggedOn,
      source: m.source,
      hours: base.hours + Number(m.hours),
      contacts: base.contacts + m.contacts,
      leads: base.leads + m.leads,
      apptsSet: base.apptsSet + m.apptsSet,
      apptsMet: base.apptsMet + m.apptsMet,
      listingsTaken: base.listingsTaken + m.listingsTaken,
      underContract: base.underContract + m.underContract,
      closed: base.closed + m.closed,
      gci: base.gci + Number(m.gci),
      // The derived side has no notes to lose, so the manual note simply
      // carries through when there is one.
      notes: m.notes ?? base.notes ?? null,
    });
  }

  return { rows: [...merged.values()], excludedSessions };
}


/** One agent's leaderboard line. Totals only — no day bucketing needed. */
export interface LeaderboardTotals {
  userId: string;
  contacts: number;
  leads: number;
  closed: number;
  gci: number;
}

/**
 * Leaderboard totals for MANY users in a fixed number of queries.
 *
 * getLeaderboard used to call getDailyRows once per opted-in agent inside a
 * Promise.all — four queries and a full day-row set per person, so a
 * twenty-agent office was 80 queries with twenty row sets live in memory at
 * once. This is three grouped queries regardless of headcount.
 *
 * Deliberately does NOT reuse getDailyRows. The leaderboard needs four totals
 * (contacts, leads, closed, gci) — not hours, and not per-day rows — so the
 * whole agent_sessions leg and the day bucketing are dead weight here. Keeping
 * the two paths separate also means this cannot regress the dashboard.
 *
 * Semantics are the same rules getDailyRows applies, expressed in SQL:
 *   - contacts: FIRST application of the CONTACT disposition per contact, once
 *     ever, floored at CONTACTS_COUNTED_FROM (see that constant for why).
 *   - leads/closed/gci: ProspectingStageEvent rows in range.
 *   - manual entries are ADDED on top, never replacing.
 */
export async function getLeaderboardTotals(
  userIds: string[],
  fromIso: string,
  toIso: string,
  timeZone: string,
): Promise<Map<string, LeaderboardTotals>> {
  const out = new Map<string, LeaderboardTotals>();
  if (userIds.length === 0) return out;

  const bump = (userId: string): LeaderboardTotals => {
    let t = out.get(userId);
    if (!t) {
      t = { userId, contacts: 0, leads: 0, closed: 0, gci: 0 };
      out.set(userId, t);
    }
    return t;
  };

  const instantGte = startOfDayInTimeZone(fromIso, timeZone);
  const instantLt = endOfDayExclusiveInTimeZone(toIso, timeZone);
  const dateGte = new Date(`${fromIso}T00:00:00.000Z`);
  const dateLt = new Date(new Date(`${toIso}T00:00:00.000Z`).getTime() + 86_400_000);
  const contactsFloor = new Date(CONTACTS_COUNTED_FROM);

  // 1. Contacts — distinct contacts whose FIRST CONTACT press falls in range.
  if (instantLt > contactsFloor) {
    const contactRows = await prisma.$queryRaw<Array<{ userId: string; contacts: bigint }>>`
      SELECT f."appliedById" AS "userId", COUNT(*)::bigint AS contacts
      FROM (
        SELECT l."appliedById", l."contactId", MIN(l."createdAt") AS first_at
        FROM contact_disposition_logs l
        JOIN dispositions d ON d.id = l."dispositionId"
        WHERE l."appliedById" = ANY(${userIds})
          AND d.value = ${CONTACTED_DISPOSITION_VALUE}
          AND l."createdAt" >= ${contactsFloor}
        GROUP BY l."appliedById", l."contactId"
      ) f
      WHERE f.first_at >= ${instantGte} AND f.first_at < ${instantLt}
      GROUP BY 1`;
    for (const r of contactRows) bump(r.userId).contacts = Number(r.contacts);
  }

  // 2. Funnel stages + GCI.
  const stageRows = await prisma.$queryRaw<
    Array<{ userId: string; stage: string; n: bigint; gci: string }>
  >`
    SELECT "userId", stage::text AS stage, COUNT(*)::bigint AS n, COALESCE(SUM(gci), 0)::text AS gci
    FROM prospecting_stage_events
    WHERE "userId" = ANY(${userIds})
      AND "occurredOn" >= ${dateGte} AND "occurredOn" < ${dateLt}
    GROUP BY 1, 2`;
  for (const r of stageRows) {
    const t = bump(r.userId);
    if (r.stage === "LEAD") t.leads += Number(r.n);
    if (r.stage === "CLOSED") {
      t.closed += Number(r.n);
      t.gci += Number(r.gci);
    }
  }

  // 3. Manual entries, ADDED on top.
  const manualRows = await prisma.$queryRaw<
    Array<{ userId: string; contacts: bigint; leads: bigint; closed: bigint; gci: string }>
  >`
    SELECT "userId",
           COALESCE(SUM(contacts), 0)::bigint AS contacts,
           COALESCE(SUM(leads), 0)::bigint    AS leads,
           COALESCE(SUM(closed), 0)::bigint   AS closed,
           COALESCE(SUM(gci), 0)::text        AS gci
    FROM prospecting_sessions
    WHERE "userId" = ANY(${userIds})
      AND "loggedOn" >= ${dateGte} AND "loggedOn" < ${dateLt}
    GROUP BY 1`;
  for (const r of manualRows) {
    const t = bump(r.userId);
    t.contacts += Number(r.contacts);
    t.leads += Number(r.leads);
    t.closed += Number(r.closed);
    t.gci += Number(r.gci);
  }

  return out;
}
