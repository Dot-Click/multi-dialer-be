/**
 * Funnel definition — the single source of truth for stage order and labels.
 *
 * Everything downstream (dashboard strip, funnel chart, attainment table, CSV
 * export) derives from these arrays. Add a stage here and it appears
 * everywhere; there is no second list to keep in sync.
 */

import type { StageId } from './types';

export interface StageMeta {
  id: StageId;
  label: string;
  short: string;
  /** 'count' renders as an integer, 'hours' to 1dp, 'money' as currency. */
  kind: 'count' | 'hours' | 'money';
}

export const STAGE_META: Readonly<Record<StageId, StageMeta>> = {
  hours: { id: 'hours', label: 'Hours prospected', short: 'Hours', kind: 'hours' },
  contacts: { id: 'contacts', label: 'Contacts', short: 'Contacts', kind: 'count' },
  leads: { id: 'leads', label: 'Leads', short: 'Leads', kind: 'count' },
  apptsSet: { id: 'apptsSet', label: 'Appointments set', short: 'Set', kind: 'count' },
  apptsMet: { id: 'apptsMet', label: 'Appointments met', short: 'Met', kind: 'count' },
  listingsTaken: { id: 'listingsTaken', label: 'Listings taken', short: 'Taken', kind: 'count' },
  underContract: { id: 'underContract', label: 'Under contract', short: 'U/C', kind: 'count' },
  closed: { id: 'closed', label: 'Closed', short: 'Closed', kind: 'count' },
  gci: { id: 'gci', label: 'GCI', short: 'GCI', kind: 'money' },
};

/** Saleslytics-identical: no Under Contract stage. */
export const STAGES_WITHOUT_UC: readonly StageId[] = [
  'hours', 'contacts', 'leads', 'apptsSet', 'apptsMet', 'listingsTaken', 'closed', 'gci',
];

/** Slingvo default: Under Contract sits between Taken and Closed. */
export const STAGES_WITH_UC: readonly StageId[] = [
  'hours', 'contacts', 'leads', 'apptsSet', 'apptsMet', 'listingsTaken', 'underContract', 'closed', 'gci',
];

export function stagesFor(includeUnderContract: boolean): readonly StageId[] {
  return includeUnderContract ? STAGES_WITH_UC : STAGES_WITHOUT_UC;
}

/** A step between two adjacent stages, keyed to its ActualKpis field. */
export interface StepMeta {
  from: StageId;
  to: StageId;
  label: string;
  kpiKey:
    | 'contactsPerHour'
    | 'contactToLead'
    | 'leadToSet'
    | 'setToMet'
    | 'metToTaken'
    | 'takenToUnderContract'
    | 'underContractToClosed'
    | 'takenToClosed';
  /** 'rate' renders as a multiplier (6.84), 'pct' as a percentage. */
  display: 'rate' | 'pct';
}

const STEP_CONTACTS_PER_HOUR: StepMeta = {
  from: 'hours', to: 'contacts', label: 'Contacts / Hour', kpiKey: 'contactsPerHour', display: 'rate',
};
const STEP_C2L: StepMeta = {
  from: 'contacts', to: 'leads', label: 'Contact → Lead', kpiKey: 'contactToLead', display: 'pct',
};
const STEP_L2S: StepMeta = {
  from: 'leads', to: 'apptsSet', label: 'Lead → Set', kpiKey: 'leadToSet', display: 'pct',
};
const STEP_S2M: StepMeta = {
  from: 'apptsSet', to: 'apptsMet', label: 'Set → Met', kpiKey: 'setToMet', display: 'pct',
};
const STEP_M2T: StepMeta = {
  from: 'apptsMet', to: 'listingsTaken', label: 'Met → Taken', kpiKey: 'metToTaken', display: 'pct',
};
const STEP_T2U: StepMeta = {
  from: 'listingsTaken', to: 'underContract', label: 'Taken → U/C', kpiKey: 'takenToUnderContract', display: 'pct',
};
const STEP_U2C: StepMeta = {
  from: 'underContract', to: 'closed', label: 'U/C → Closed', kpiKey: 'underContractToClosed', display: 'pct',
};
const STEP_T2C: StepMeta = {
  from: 'listingsTaken', to: 'closed', label: 'Taken → Closed', kpiKey: 'takenToClosed', display: 'pct',
};

/**
 * The six ratios Saleslytics shows under "Actual KPIs", in its order.
 * With Under Contract enabled, Taken → Closed splits into two steps (seven).
 */
export function stepsFor(includeUnderContract: boolean): readonly StepMeta[] {
  const head = [STEP_CONTACTS_PER_HOUR, STEP_C2L, STEP_L2S, STEP_S2M, STEP_M2T];
  return includeUnderContract
    ? [...head, STEP_T2U, STEP_U2C]
    : [...head, STEP_T2C];
}
