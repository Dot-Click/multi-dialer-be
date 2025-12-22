import { z } from 'zod';

// Match your Prisma Enums
const SchedType = z.enum(['FREQUENCY_BASED', 'DATE_BASED']);
const ActionType = z.enum(['EMAIL', 'PHONE_CALL', 'TASK', 'LETTER', 'MAILING_LABEL']);
const TriggerType = z.enum(['NONE', 'CALLING_LIST', 'GROUP']);
const EndLogic = z.enum(['DO_NOTHING', 'REPEAT_PLAN', 'START_OTHER_PLAN']);

export const actionPlanSchema = z.object({
  name: z.string().min(1, "Name is required"),
  schedulingType: SchedType.default('FREQUENCY_BASED'),
  schedulingLogic: SchedType.default('FREQUENCY_BASED'),
  weekendScheduling: SchedType.default('FREQUENCY_BASED'),
  triggerType: TriggerType.default('NONE'),
  triggerSourceId: z.string().optional().nullable(),
  removeOnTriggerExit: z.boolean().default(false),
  endLogic: EndLogic.default('DO_NOTHING'),
  assignGroupEnabled: z.boolean().default(false),
  assignGroupId: z.string().optional().nullable(),
  steps: z.array(z.object({
    order: z.number().int(),
    actionType: ActionType,
    contentValue: z.string().min(1, "Step content is required"),
    dayOffset: z.number().int().default(0)
  })).min(1, "At least one step is required")
});