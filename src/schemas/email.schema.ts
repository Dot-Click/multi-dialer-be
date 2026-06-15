import { z } from "zod";

export const createEmailSchema = z.object({
  templateName: z
    .string()
    .min(1, "Template name is required")
    .max(255, "Template name must be 255 characters or less"),
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(500, "Subject must be 500 characters or less"),
  content: z
    .string()
    .min(1, "Content is required"),
  includeSignature: z.boolean().optional(),
});

export const updateEmailSchema = z.object({
  templateName: z.string().min(1).max(255).optional(),
  subject: z.string().min(1).max(500).optional(),
  content: z.string().min(1).optional(),
  status: z.boolean().optional(),
  includeSignature: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

export type CreateEmailInput = z.infer<typeof createEmailSchema>;
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;
