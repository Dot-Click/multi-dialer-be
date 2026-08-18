/**
 * Business plan — the top-down planner.
 *
 * Reverse-engineered from saleslytics.io on 2026-07-30 and verified against
 * its own `/edit-business-plan` inputs. With `includeUnderContract: false` and
 * the defaults below, `annualTargets()` reproduces every figure Saleslytics
 * renders across Yearly / Monthly / Weekly / Daily, to the unit.
 *
 * TWO RULES THAT ARE EASY TO GET WRONG
 *
 *  1. The chain carries UNROUNDED values end to end. Rounding at each step
 *     compounds drift and puts the contact target out by dozens. Round once,
 *     at render time, via `roundTargets()`.
 *
 *  2. Period divisors are 1 / 12 / 50 / 250 — working weeks, not calendar
 *     weeks. Dividing by 52 and 365 produces numbers that look plausible and
 *     are wrong.
 */

import type {
  BusinessPlanInputs,
  PeriodKey,
  PlanTargets,
  WorkingCalendar,
} from './types';

export const DEFAULT_CALENDAR: WorkingCalendar = {
  workingWeeksPerYear: 50,
  workingDaysPerWeek: 5,
};

/**
 * Saleslytics' shipped defaults, read directly from its edit form.
 *
 * `takenToUnderContractPct` and `underContractToClosedPct` are OURS, not
 * theirs — Saleslytics has no Under Contract stage. They are chosen so that
 * 0.85 x 0.824 = 0.7004, i.e. the composite Taken -> Closed rate still lands
 * on Saleslytics' 70%, so switching the stage on doesn't silently move the
 * plan. Replace both with your own measured rates once you have a full year.
 */
export const SALESLYTICS_DEFAULTS: BusinessPlanInputs = {
  netIncomeGoal: 180_000,
  avgCommissionRatePct: 2.9,
  avgPricePoint: 400_000,
  profitMarginPct: 70,

  contactsPerHour: 7,
  contactToLeadPct: 10,
  leadToSetPct: 20,
  setToMetPct: 50,
  metToTakenPct: 50,

  takenToClosedPct: 70,
  takenToUnderContractPct: 85,
  underContractToClosedPct: 82.4,

  includeUnderContract: false,
  calendar: DEFAULT_CALENDAR,
};

/** Divide by a percentage expressed as a whole number (70 -> /0.70). */
function divideByPct(value: number, pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) {
    throw new RangeError(
      `Conversion percentages must be greater than 0; received ${pct}. ` +
        'A rate of 0 would require infinite activity.',
    );
  }
  return value / (pct / 100);
}

/** Validate inputs up front so failures name the offending field. */
export function assertValidPlan(input: BusinessPlanInputs): void {
  const positive: Array<[string, number]> = [
    ['netIncomeGoal', input.netIncomeGoal],
    ['avgCommissionRatePct', input.avgCommissionRatePct],
    ['avgPricePoint', input.avgPricePoint],
    ['profitMarginPct', input.profitMarginPct],
    ['contactsPerHour', input.contactsPerHour],
    ['contactToLeadPct', input.contactToLeadPct],
    ['leadToSetPct', input.leadToSetPct],
    ['setToMetPct', input.setToMetPct],
    ['metToTakenPct', input.metToTakenPct],
  ];
  if (input.includeUnderContract) {
    positive.push(['takenToUnderContractPct', input.takenToUnderContractPct]);
    positive.push(['underContractToClosedPct', input.underContractToClosedPct]);
  } else {
    positive.push(['takenToClosedPct', input.takenToClosedPct]);
  }
  for (const [name, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a number greater than 0; received ${value}`);
    }
  }
  const { workingWeeksPerYear, workingDaysPerWeek } = input.calendar;
  if (!Number.isFinite(workingWeeksPerYear) || workingWeeksPerYear <= 0) {
    throw new RangeError(`calendar.workingWeeksPerYear must be > 0; received ${workingWeeksPerYear}`);
  }
  if (!Number.isFinite(workingDaysPerWeek) || workingDaysPerWeek <= 0) {
    throw new RangeError(`calendar.workingDaysPerWeek must be > 0; received ${workingDaysPerWeek}`);
  }
}

/**
 * Walk the funnel backwards from the income goal to the hours required.
 * Returns unrounded values.
 */
export function annualTargets(input: BusinessPlanInputs): PlanTargets {
  assertValidPlan(input);

  const avgCommission = input.avgPricePoint * (input.avgCommissionRatePct / 100);
  const gciNeeded = divideByPct(input.netIncomeGoal, input.profitMarginPct);
  const closed = gciNeeded / avgCommission;

  let underContract: number;
  let listingsTaken: number;
  if (input.includeUnderContract) {
    underContract = divideByPct(closed, input.underContractToClosedPct);
    listingsTaken = divideByPct(underContract, input.takenToUnderContractPct);
  } else {
    listingsTaken = divideByPct(closed, input.takenToClosedPct);
    // Not part of the chain in 8-stage mode; surfaced as 0 rather than NaN.
    underContract = 0;
  }

  const apptsMet = divideByPct(listingsTaken, input.metToTakenPct);
  const apptsSet = divideByPct(apptsMet, input.setToMetPct);
  const leads = divideByPct(apptsSet, input.leadToSetPct);
  const contacts = divideByPct(leads, input.contactToLeadPct);
  const hours = contacts / input.contactsPerHour;

  return {
    avgCommission,
    gciNeeded,
    closed,
    underContract,
    listingsTaken,
    apptsMet,
    apptsSet,
    leads,
    contacts,
    hours,
  };
}

/**
 * How many of each period fit in a planning year.
 * yearly 1 · monthly 12 · weekly = working weeks · daily = weeks x days.
 */
export function periodDivisor(
  period: PeriodKey,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): number {
  switch (period) {
    case 'yearly':
      return 1;
    case 'monthly':
      return 12;
    case 'weekly':
      return calendar.workingWeeksPerYear;
    case 'daily':
      return calendar.workingWeeksPerYear * calendar.workingDaysPerWeek;
    default: {
      // Exhaustiveness guard — unreachable while PeriodKey is honoured.
      const never: never = period;
      throw new RangeError(`Unknown period: ${String(never)}`);
    }
  }
}

/**
 * Scale annual targets down to a period. `avgCommission` is a per-deal rate,
 * not a volume, so it is deliberately NOT divided.
 */
export function targetsForPeriod(
  targets: PlanTargets,
  period: PeriodKey,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): PlanTargets {
  const d = periodDivisor(period, calendar);
  return {
    avgCommission: targets.avgCommission,
    gciNeeded: targets.gciNeeded / d,
    closed: targets.closed / d,
    underContract: targets.underContract / d,
    listingsTaken: targets.listingsTaken / d,
    apptsMet: targets.apptsMet / d,
    apptsSet: targets.apptsSet / d,
    leads: targets.leads / d,
    contacts: targets.contacts / d,
    hours: targets.hours / d,
  };
}

/** Convenience: plan + period in one call. */
export function planForPeriod(
  input: BusinessPlanInputs,
  period: PeriodKey,
): PlanTargets {
  return targetsForPeriod(annualTargets(input), period, input.calendar);
}

/**
 * Round for display. Half-up on .5 to match Saleslytics
 * (JavaScript's Math.round is already half-up for positive numbers).
 */
export function roundTargets(targets: PlanTargets): PlanTargets {
  return {
    avgCommission: Math.round(targets.avgCommission),
    gciNeeded: Math.round(targets.gciNeeded),
    closed: Math.round(targets.closed),
    underContract: Math.round(targets.underContract),
    listingsTaken: Math.round(targets.listingsTaken),
    apptsMet: Math.round(targets.apptsMet),
    apptsSet: Math.round(targets.apptsSet),
    leads: Math.round(targets.leads),
    contacts: Math.round(targets.contacts),
    hours: Math.round(targets.hours),
  };
}
