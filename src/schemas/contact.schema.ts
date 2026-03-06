import { z } from "zod";

export const contactEmailSchema = z.object({
  email: z.string().email(),
  isPrimary: z.boolean().default(false),
});

export const contactPhoneSchema = z.object({
  number: z.string().min(1),
  type: z.enum(["MOBILE", "TELEPHONE", "HOME", "WORK"]),
});

export const createContactSchema = z.object({
  fullName: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string().min(1)).default([]),
  dataDialerId: z.string().optional(),
  emails: z.array(contactEmailSchema).default([]),
  phones: z.array(contactPhoneSchema).default([]),
  notes: z.string().optional(),
  contactListId: z.string().optional(),
});

export const updateContactSchema = z.object({
  fullName: z.string().min(1).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  dataDialerId: z.string().nullable().optional(),
  emails: z.array(contactEmailSchema).optional(),
  phones: z.array(contactPhoneSchema).optional(),
  notes: z.string().optional(),
});


export const createListFolderSchema = z.object({
  name: z.string().min(1),
  listIds: z.array(z.string().min(1)).default([]),
});

export const createContactGroupSchema = z.object({
  name: z.string().min(1),
  contactIds: z.array(z.string().min(1)).default([]),
});