import { z } from "zod";

export const upsertSmtpConfigSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  fromName: z.string().min(1, "From name is required"),
  fromEmail: z.string().email("A valid from email is required"),
});
