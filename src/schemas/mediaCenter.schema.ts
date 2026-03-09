import { z } from "zod";

export const createMediaCenterSchema = z.object({
  templateName: z.string().min(1, "Template name is required"),
  mediaType: z.enum(["VOICE_MAIL", "ON_HOLD", "CALLBACK_MESSAGE", "EMAIL_VIDEO"]),
});

export const updateMediaCenterSchema = z.object({
  templateName: z.string().min(1).optional(),
  mediaType: z.enum(["VOICE_MAIL", "ON_HOLD", "CALLBACK_MESSAGE", "EMAIL_VIDEO"]).optional(),
});

