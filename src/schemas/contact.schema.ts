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
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  mailingAddress: z.string().optional(),
  mailingCity: z.string().optional(),
  mailingState: z.string().optional(),
  mailingZip: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string().min(1)).default([]),
  dataDialerId: z.string().optional(),
  emails: z.array(contactEmailSchema).default([]),
  phones: z.array(contactPhoneSchema).default([]),
  notes: z.array(z.string()).default([]),
  contactListId: z.string().optional(),
  miscValues: z.record(z.string(), z.any()).optional(),
  leadsheetValues: z.record(z.string(), z.any()).optional(),
  permission: z.boolean().optional(),
  want: z.boolean().optional(),
  why: z.boolean().optional(),
  statusQuo: z.boolean().optional(),
  timeline: z.boolean().optional(),
  agent: z.boolean().optional(),
  folderIds: z.array(z.string()).optional(),
});

export const updateContactSchema = z.object({
  fullName: z.string().min(1).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  mailingAddress: z.string().optional(),
  mailingCity: z.string().optional(),
  mailingState: z.string().optional(),
  mailingZip: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  dataDialerId: z.string().nullable().optional(),
  emails: z.array(contactEmailSchema).optional(),
  phones: z.array(contactPhoneSchema).optional(),
  notes: z.array(z.string()).optional(),
  miscValues: z.record(z.string(), z.any()).optional(),
  leadsheetValues: z.record(z.string(), z.any()).optional(),
  status: z.string().optional(),
  disposition: z.string().optional(),
  permission: z.boolean().optional(),
  want: z.boolean().optional(),
  why: z.boolean().optional(),
  statusQuo: z.boolean().optional(),
  timeline: z.boolean().optional(),
  agent: z.boolean().optional(),
});


export const createListFolderSchema = z.object({
  name: z.string().min(1),
  listIds: z.array(z.string().min(1)).default([]),
  parentId: z.string().optional(),
});

export const createContactGroupSchema = z.object({
  name: z.string().min(1),
  contactIds: z.array(z.string().min(1)).default([]),
});