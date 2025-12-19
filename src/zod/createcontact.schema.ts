import { z } from "zod";

// Base schema for creation
export const createContactSchema = z.object({
  dataDialerId: z.string().uuid().optional(), // Must be optional for "Auto" logic
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(10),
  phoneType: z.enum(["Mobile", "Home", "Work", "Other"]).default("Mobile"),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  folderId: z.string().uuid().optional(),
  listId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
});

// IMPORTANT: Use .partial() so everything is optional for updates
export const updateContactSchema = createContactSchema.partial();