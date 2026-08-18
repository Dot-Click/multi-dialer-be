/**
 * Slingvo Prospecting Tracker — domain layer public surface.
 *
 * Pure functions only. No I/O, no framework, no Prisma import, no dates
 * beyond ISO strings. Copied unchanged from the client-supplied domain layer
 * (v2.0, 2026-07-31; 68 passing tests) — only the relative import extensions
 * were adjusted to match this project's build (tsc + tsc-alias, NodeNext,
 * extensionless relative imports). Import this from route services, never
 * the other way around.
 */

export type {
  ActualKpis,
  BusinessPlanInputs,
  CountableStageId,
  PeriodKey,
  PlanTargets,
  SessionRow,
  SessionTotals,
  StageAttainment,
  StageId,
  WorkingCalendar,
} from './types';

export {
  DEFAULT_CALENDAR,
  SALESLYTICS_DEFAULTS,
  annualTargets,
  assertValidPlan,
  periodDivisor,
  planForPeriod,
  roundTargets,
  targetsForPeriod,
} from './businessPlan';

export {
  actualForStage,
  aggregateSessions,
  computeActualKpis,
  computeAttainment,
  elapsedFraction,
  filterByDateRange,
  projectedGci,
  ratio,
  targetForStage,
} from './actuals';

export {
  STAGES_WITHOUT_UC,
  STAGES_WITH_UC,
  STAGE_META,
  stagesFor,
  stepsFor,
} from './funnel';
export type { StageMeta, StepMeta } from './funnel';

export { computeStreak, coverageWindow } from './streak';
export type { StreakOptions, StreakResult } from './streak';
