import { z } from "zod";

export const createSmsSchema = z.object({
    templateName: z.string(),
    content: z.string(),
});

export const updateSmsSchema = z.object({
    templateName: z.string().optional(),
    content: z.string().optional(),
    status: z.boolean().optional(),
});


