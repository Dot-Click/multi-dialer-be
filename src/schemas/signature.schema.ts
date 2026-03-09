import { z } from "zod";

export const signatureSchema = z.object({
  content: z.string().min(1, "Signature content is required"),
});

export type SignatureInput = z.infer<typeof signatureSchema>;