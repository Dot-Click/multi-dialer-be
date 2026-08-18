import { ProspectingStage } from "@prisma/client";

/**
 * Maps the six Disposition.value strings that represent a Prospecting
 * Tracker funnel stage onto the ProspectingStage enum. "LEAD" and
 * "APPOINTMENT_SET" are pre-existing default Dispositions (seeded for every
 * account before this feature existed); the other four are seeded by
 * DispositionService specifically for the tracker — see
 * systemSettings/dispositions/service.ts.
 *
 * Deliberately NOT exhaustive over every Disposition.value in the system —
 * temperature tags (HOT/WARM/COLD/...) and call outcomes (NO_ANSWER,
 * VOICEMAIL, ...) have no entry here and are correctly ignored by
 * stageForDispositionValue.
 */
const DISPOSITION_VALUE_TO_STAGE: Readonly<Record<string, ProspectingStage>> = {
  LEAD: ProspectingStage.LEAD,
  APPOINTMENT_SET: ProspectingStage.APPT_SET,
  APPOINTMENT_MET: ProspectingStage.APPT_MET,
  LISTING_TAKEN: ProspectingStage.LISTING_TAKEN,
  UNDER_CONTRACT: ProspectingStage.UNDER_CONTRACT,
  CLOSED: ProspectingStage.CLOSED,
};

export function stageForDispositionValue(value: string | null | undefined): ProspectingStage | null {
  if (!value) return null;
  return DISPOSITION_VALUE_TO_STAGE[value] ?? null;
}
