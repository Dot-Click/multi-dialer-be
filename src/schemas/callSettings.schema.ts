import { z } from "zod";

export const createCallSettingsSchema = z.object({
  label: z.string().min(1, "Label is required"),
  countryCode: z.string().min(1, "Country code is required"),

  // Recording slots — accept the ID directly
  onHoldRecording1Id: z.string().uuid().optional().nullable(),
  onHoldRecording2Id: z.string().uuid().optional().nullable(),
  ivrRecordingId: z.string().uuid().optional().nullable(),
  answeringMachineRecordingId: z.string().uuid().optional().nullable(),
  busyRecordingId: z.string().uuid().optional().nullable(),

  enableAutoPause: z.boolean().optional(),
  enableRecording: z.boolean().optional(),
  sendOutlookAppointment: z.boolean().optional(),
  allowDncCalls: z.boolean().optional(),
  callerId: z.string().optional(),
  numberOfLines: z.number().int().positive().optional(),
  ringTime: z.number().int().positive().optional(),
  callScriptId: z.string().optional(),
  sendEmail: z.boolean().optional(),
  sendText: z.boolean().optional(),
  amdEnabled: z.boolean().optional(),
});

export const updateCallSettingsSchema = z.object({
  label: z.string().min(1).optional(),
  countryCode: z.string().min(1).optional(),

  // Recording slots — pass null to clear a slot, a UUID to assign one
  onHoldRecording1Id: z.string().uuid().optional().nullable(),
  onHoldRecording2Id: z.string().uuid().optional().nullable(),
  ivrRecordingId: z.string().uuid().optional().nullable(),
  answeringMachineRecordingId: z.string().uuid().optional().nullable(),
  busyRecordingId: z.string().uuid().optional().nullable(),

  enableAutoPause: z.boolean().optional(),
  enableRecording: z.boolean().optional(),
  sendOutlookAppointment: z.boolean().optional(),
  allowDncCalls: z.boolean().optional(),
  callerId: z.string().optional(),
  numberOfLines: z.number().int().positive().optional(),
  ringTime: z.number().int().positive().optional(),
  callScriptId: z.string().optional(),
  sendEmail: z.boolean().optional(),
  sendText: z.boolean().optional(),
  amdEnabled: z.boolean().optional(),
});