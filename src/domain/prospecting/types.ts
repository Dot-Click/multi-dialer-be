/**
 * Slingvo Prospecting Tracker — shared domain types.
 *
 * Deliberately dependency-free. Copied unchanged from the client-supplied
 * domain layer (v2.0, 2026-07-31) — do not add Prisma/Express types here.
 * Import from the service layer, never the other way around.
 */

/* ------------------------------------------------------------------ periods */

export type PeriodKey = 'yearly' | 'monthly' | 'weekly' | 'daily';

/**
 * How many working weeks / days the plan assumes.
 *
 * Saleslytics uses 50 working weeks and 5 working days, which is why its
 * weekly figures divide by 50 and its daily figures by 250 — NOT 52 and 365.
 * Keeping these configurable lets an agent model a different working year
 * without touching the calculation code.
 */
export interface WorkingCalendar {
  workingWeeksPerYear: number;
  workingDaysPerWeek: number;
}

/* ------------------------------------------------------------------- funnel */

/**
 * Funnel stages in order.
 *
 * `underContract` sits between `listingsTaken` and `closed`. Saleslytics has no
 * such stage — it goes Taken -> Closed directly. We keep it because Jason logs
 * it, and it is switched on/off by `BusinessPlanInputs.includeUnderContract`.
 */
export type StageId =
  | 'hours'
  | 'contacts'
  | 'leads'
  | 'apptsSet'
  | 'apptsMet'
  | 'listingsTaken'
  | 'underContract'
  | 'closed'
  | 'gci';

export type CountableStageId = Exclude<StageId, 'hours' | 'gci'>;

/* -------------------------------------------------------------- plan inputs */

/**
 * Every user-editable input on the business plan.
 *
 * Percentages are stored as whole numbers (70 means 70%), matching how
 * Saleslytics stores them in its own edit form. Convert with `/100` at the
 * point of use — never store fractions, it makes the admin UI ambiguous.
 */
export interface BusinessPlanInputs {
  /** Take-home income target for the year, after expenses and splits. */
  netIncomeGoal: number;
  /** Gross commission as a % of sale price. Saleslytics default: 2.9 */
  avgCommissionRatePct: number;
  /** Average sale price. Saleslytics default: 400000 */
  avgPricePoint: number;
  /** Net income as a % of GCI. Saleslytics default: 70 */
  profitMarginPct: number;

  /** Conversations per hour of prospecting. Saleslytics default: 7 */
  contactsPerHour: number;
  /** Saleslytics default: 10 */
  contactToLeadPct: number;
  /** Saleslytics default: 20 */
  leadToSetPct: number;
  /** Saleslytics default: 50 */
  setToMetPct: number;
  /** Saleslytics default: 50 */
  metToTakenPct: number;

  /**
   * Used only when `includeUnderContract` is false.
   * Saleslytics default: 70
   */
  takenToClosedPct: number;

  /** Used only when `includeUnderContract` is true. */
  takenToUnderContractPct: number;
  /** Used only when `includeUnderContract` is true. */
  underContractToClosedPct: number;

  /**
   * When true the funnel is Taken -> Under Contract -> Closed (9 stages).
   * When false it is Taken -> Closed (8 stages), identical to Saleslytics.
   */
  includeUnderContract: boolean;

  calendar: WorkingCalendar;
}

/** Annual targets, carried UNROUNDED. Round only when rendering. */
export interface PlanTargets {
  avgCommission: number;
  gciNeeded: number;
  closed: number;
  underContract: number;
  listingsTaken: number;
  apptsMet: number;
  apptsSet: number;
  leads: number;
  contacts: number;
  hours: number;
}

/* ----------------------------------------------------------------- sessions */

/** One logged prospecting block. Unique on (userId, loggedOn, source). */
export interface SessionRow {
  id?: string;
  userId?: string;
  /** ISO date, `YYYY-MM-DD`. Stored as a DATE — never a timestamp. */
  loggedOn: string;
  source: string | null;
  hours: number;
  contacts: number;
  leads: number;
  apptsSet: number;
  apptsMet: number;
  listingsTaken: number;
  underContract: number;
  closed: number;
  gci: number;
  notes?: string | null;
}

/** Straight sums over a set of sessions. */
export interface SessionTotals {
  sessions: number;
  daysLogged: number;
  daysProspected: number;
  hours: number;
  contacts: number;
  leads: number;
  apptsSet: number;
  apptsMet: number;
  listingsTaken: number;
  underContract: number;
  closed: number;
  gci: number;
}

/**
 * Measured conversion ratios. `null` means "not computable" — the denominator
 * was zero. Never coerce these to 0; a missing ratio and a 0% ratio mean very
 * different things to an agent reading the dashboard.
 */
export interface ActualKpis {
  contactsPerHour: number | null;
  contactToLead: number | null;
  leadToSet: number | null;
  setToMet: number | null;
  metToTaken: number | null;
  takenToUnderContract: number | null;
  underContractToClosed: number | null;
  takenToClosed: number | null;

  gciPerHour: number | null;
  gciPerContact: number | null;
  gciPerLead: number | null;
  gciPerClosing: number | null;
  contactsPerClosing: number | null;
  hoursPerClosing: number | null;
  leadsPerHour: number | null;
  avgHoursPerDayProspected: number | null;
}

/** Actual vs target for one stage. */
export interface StageAttainment {
  stage: StageId;
  actual: number;
  target: number;
  /** actual / target, or null when target is 0. */
  attainment: number | null;
}
