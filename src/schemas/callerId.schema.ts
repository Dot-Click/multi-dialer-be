import { z } from "zod";

export const createCallerIdSchema = z.object({
  label: z.string().min(1, "Label is required"),
  countryCode: z.string().min(1, "Country code is required"),
  numberOfLines: z.number().int().positive().optional(),
  dialerType: z.enum(["PREDICTIVE", "POWER", "PREVIEW"]).optional(),
  aiPacing: z.boolean().optional(),
  twillioSid: z.string().optional(),
  twillioNumber: z.string().optional(),
  agentIds: z.array(z.string()).optional(),
});

export const updateCallerIdSchema = z.object({
  label: z.string().min(1).optional(),
  countryCode: z.string().min(1).optional(),
  numberOfLines: z.number().int().positive().optional(),
  dialerType: z.enum(["PREDICTIVE", "POWER", "PREVIEW"]).optional(),
  aiPacing: z.boolean().optional(),
  twillioSid: z.string().optional(),
  twillioNumber: z.string().optional(),
  agentIds: z.array(z.string()).optional(),
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