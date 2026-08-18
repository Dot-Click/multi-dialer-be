/**
 * Actuals — aggregate logged sessions and derive measured conversion ratios.
 *
 * These are the "Actual KPIs" tiles on the Saleslytics dashboard, plus the
 * money metrics an agent actually acts on ($ per contact, hours per closing).
 */

import type {
  ActualKpis,
  PlanTargets,
  SessionRow,
  SessionTotals,
  StageAttainment,
  StageId,
} from './types';

/**
 * Guarded division. Returns null — never 0, never Infinity, never NaN — when
 * the denominator is missing. A dashboard must render "—" in that case, not a
 * confident zero.
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

const EMPTY_TOTALS: SessionTotals = {
  sessions: 0,
  daysLogged: 0,
  daysProspected: 0,
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

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum sessions.
 *
 * `daysLogged` counts distinct calendar dates with any row.
 * `daysProspected` counts distinct dates with hours > 0 — the honest
 * denominator for "average hours per day", since zero-hour rows exist purely
 * to record a closing on a day no prospecting happened.
 */
export function aggregateSessions(rows: readonly SessionRow[]): SessionTotals {
  if (rows.length === 0) return { ...EMPTY_TOTALS };

  const t: SessionTotals = { ...EMPTY_TOTALS };
  const allDates = new Set<string>();
  const workedDates = new Set<string>();

  for (const r of rows) {
    const hours = num(r.hours);
    t.sessions += 1;
    t.hours += hours;
    t.contacts += num(r.contacts);
    t.leads += num(r.leads);
    t.apptsSet += num(r.apptsSet);
    t.apptsMet += num(r.apptsMet);
    t.listingsTaken += num(r.listingsTaken);
    t.underContract += num(r.underContract);
    t.closed += num(r.closed);
    t.gci += num(r.gci);

    if (r.loggedOn) {
      allDates.add(r.loggedOn);
      if (hours > 0) workedDates.add(r.loggedOn);
    }
  }

  t.daysLogged = allDates.size;
  t.daysProspected = workedDates.size;
  return t;
}

/** Filter to an inclusive ISO date range. Either bound may be omitted. */
export function filterByDateRange(
  rows: readonly SessionRow[],
  fromIso?: string | null,
  toIso?: string | null,
): SessionRow[] {
  return rows.filter((r) => {
    if (fromIso && r.loggedOn < fromIso) return false;
    if (toIso && r.loggedOn > toIso) return false;
    return true;
  });
}

/**
 * The six Saleslytics ratios plus the money metrics.
 * Ratios are FRACTIONS (0.105), not percentages — format at the edge.
 */
export function computeActualKpis(t: SessionTotals): ActualKpis {
  return {
    contactsPerHour: ratio(t.contacts, t.hours),
    contactToLead: ratio(t.leads, t.contacts),
    leadToSet: ratio(t.apptsSet, t.leads),
    setToMet: ratio(t.apptsMet, t.apptsSet),
    metToTaken: ratio(t.listingsTaken, t.apptsMet),
    takenToUnderContract: ratio(t.underContract, t.listingsTaken),
    underContractToClosed: ratio(t.closed, t.underContract),
    takenToClosed: ratio(t.closed, t.listingsTaken),

    gciPerHour: ratio(t.gci, t.hours),
    gciPerContact: ratio(t.gci, t.contacts),
    gciPerLead: ratio(t.gci, t.leads),
    gciPerClosing: ratio(t.gci, t.closed),
    contactsPerClosing: ratio(t.contacts, t.closed),
    hoursPerClosing: ratio(t.hours, t.closed),
    leadsPerHour: ratio(t.leads, t.hours),
    avgHoursPerDayProspected: ratio(t.hours, t.daysProspected),
  };
}

/** Map a stage id onto its actual value. */
export function actualForStage(t: SessionTotals, stage: StageId): number {
  switch (stage) {
    case 'hours': return t.hours;
    case 'contacts': return t.contacts;
    case 'leads': return t.leads;
    case 'apptsSet': return t.apptsSet;
    case 'apptsMet': return t.apptsMet;
    case 'listingsTaken': return t.listingsTaken;
    case 'underContract': return t.underContract;
    case 'closed': return t.closed;
    case 'gci': return t.gci;
    default: {
      const never: never = stage;
      throw new RangeError(`Unknown stage: ${String(never)}`);
    }
  }
}

/** Map a stage id onto its planned target. */
export function targetForStage(p: PlanTargets, stage: StageId): number {
  switch (stage) {
    case 'hours': return p.hours;
    case 'contacts': return p.contacts;
    case 'leads': return p.leads;
    case 'apptsSet': return p.apptsSet;
    case 'apptsMet': return p.apptsMet;
    case 'listingsTaken': return p.listingsTaken;
    case 'underContract': return p.underContract;
    case 'closed': return p.closed;
    case 'gci': return p.gciNeeded;
    default: {
      const never: never = stage;
      throw new RangeError(`Unknown stage: ${String(never)}`);
    }
  }
}

/**
 * Actual vs target for each stage — the "Personal Totals vs Goals" strip.
 * Attainment is a fraction; 1.0 means on target.
 */
export function computeAttainment(
  totals: SessionTotals,
  targets: PlanTargets,
  stages: readonly StageId[],
): StageAttainment[] {
  return stages.map((stage) => {
    const actual = actualForStage(totals, stage);
    const target = targetForStage(targets, stage);
    return { stage, actual, target, attainment: ratio(actual, target) };
  });
}

/**
 * Straight-line pace: what fraction of the period has elapsed.
 * Compare against attainment to answer "am I ahead or behind?".
 */
export function elapsedFraction(
  periodStartIso: string,
  periodEndIso: string,
  todayIso: string,
): number | null {
  const start = Date.parse(periodStartIso + 'T00:00:00Z');
  const end = Date.parse(periodEndIso + 'T00:00:00Z');
  const today = Date.parse(todayIso + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(today)) return null;
  if (end <= start) return null;
  const raw = (today - start) / (end - start);
  return Math.min(1, Math.max(0, raw));
}

/**
 * Projected end-of-period GCI at the current run rate.
 * Returns null before any time has elapsed, rather than dividing by zero.
 */
export function projectedGci(gciToDate: number, elapsed: number | null): number | null {
  if (elapsed === null || elapsed <= 0) return null;
  return gciToDate / elapsed;
}
