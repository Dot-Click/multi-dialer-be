import { z } from "zod";

export const createContactListSchema = z.object({
  name: z.string().min(1),
  tag: z.enum(["INTERESTED", "FOLLOW_UP", "DNC", "NOT_INTERESTED"]),
  agentIds: z.array(z.string().min(1)).default([]),
});

export const updateContactListSchema = z.object({
  name: z.string().min(1).optional(),
  tag: z.enum(["INTERESTED", "FOLLOW_UP", "DNC", "NOT_INTERESTED"]).optional(),
  agentIds: z.array(z.string().min(1)).optional(), // if provided, will replace assigned agents
});


