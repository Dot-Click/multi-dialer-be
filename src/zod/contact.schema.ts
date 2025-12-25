import { z } from "zod";

export const createContactSchema = z.object({
  fullName: z.string().min(1),
  address: z.string().min(1),
  email: z.string().email(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  phoneNumber: z.string().min(1),
  phoneType: z.enum(["MOBILE", "TELEPHONE"]),
  contactListId: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  dataDialerId: z.string().optional(),
});

export const updateContactSchema = z.object({
  fullName: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  email: z.string().email().optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zip: z.string().min(1).optional(),
  phoneNumber: z.string().min(1).optional(),
  phoneType: z.enum(["MOBILE", "TELEPHONE"]).optional(),
  tags: z.array(z.string().min(1)).optional(),
  dataDialerId: z.string().nullable().optional(),
});


