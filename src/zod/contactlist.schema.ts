import { z } from "zod";

export const createContactListSchema = z.object({
  name: z.string().min(1),
  agentIds: z.array(z.string().min(1)).default([]),
  contactIds: z.array(z.string().min(1)).default([]),
});

export const updateContactListSchema = z.object({
  name: z.string().min(1).optional(),
  // agentIds will be MERGED (not overwritten) in service
  agentIds: z.array(z.string().min(1)).optional(),
  // contactIds (if provided) will be replaced as-is
  contactIds: z.array(z.string().min(1)).optional(),
});


