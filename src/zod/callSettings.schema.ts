import { z } from "zod";

export const createCallSettingsSchema = z.object({
  label: z.string().min(1, "Label is required"),
  onHoldRecording1: z.string().optional(),
  onHoldRecording2: z.string().optional(),
  ivrRecording: z.string().optional(),
  answeringMachineRecording: z.string().optional(),
  enableAutoPause: z.boolean().optional(),
  enableRecording: z.boolean().optional(),
  sendOutlookAppointment: z.boolean().optional(),
  allowDncCalls: z.boolean().optional(),
  callerId: z.string().optional(),
  countryCode: z.string().min(1, "Country code is required"),
  numberOfLines: z.number().int().positive().optional(),
  ringTime: z.number().int().positive().optional(),
  callScriptId: z.string().optional(),
  sendEmail: z.boolean().optional(),
  sendText: z.boolean().optional(),
});

export const updateCallSettingsSchema = z.object({
  label: z.string().min(1).optional(),
  onHoldRecording1: z.string().optional(),
  onHoldRecording2: z.string().optional(),
  ivrRecording: z.string().optional(),
  answeringMachineRecording: z.string().optional(),
  enableAutoPause: z.boolean().optional(),
  enableRecording: z.boolean().optional(),
  sendOutlookAppointment: z.boolean().optional(),
  allowDncCalls: z.boolean().optional(),
  callerId: z.string().optional(),
  countryCode: z.string().min(1).optional(),
  numberOfLines: z.number().int().positive().optional(),
  ringTime: z.number().int().positive().optional(),
  callScriptId: z.string().optional(),
  sendEmail: z.boolean().optional(),
  sendText: z.boolean().optional(),
});

