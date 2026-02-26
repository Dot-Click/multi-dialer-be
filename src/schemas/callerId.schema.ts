import { z } from "zod";

export const createCallerIdSchema = z.object({
  label: z.string().min(1, "Label is required"),
  availableTo: z.array(z.enum(["ALL", "SALES", "SUPPORT", "PROJECT_MANAGER"])).optional(),
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
  dialerType: z.enum(["PREDICTIVE", "POWER", "PREVIEW"]).optional(),
  aiPacing: z.boolean().optional(),
  sid: z.string().optional(),
  friendlyName: z.string().optional(),
});

export const updateCallerIdSchema = z.object({
  label: z.string().min(1).optional(),
  availableTo: z.array(z.enum(["ALL", "SALES", "SUPPORT", "PROJECT_MANAGER"])).optional(),
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
  dialerType: z.enum(["PREDICTIVE", "POWER", "PREVIEW"]).optional(),
  aiPacing: z.boolean().optional(),
  sid: z.string().optional(),
  friendlyName: z.string().optional(),
});


export const addLeadsToDialerSchema = z.object({
  leads: z.array(z.object({
    fullName: z.string().min(1, "Full name is required"),
    phone: z.string().min(1, "Phone number is required"),
    priority: z.number().int().positive().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    phoneType: z.enum(["MOBILE", "HOME", "WORK"]).optional(),
  })),
});