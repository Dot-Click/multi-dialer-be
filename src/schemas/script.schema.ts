import { z } from "zod";

export const createScriptSchema = z.object({
    scriptName: z.string(),
    scriptText: z.string(),
    status: z.boolean().optional(),   
});

export const updateScriptSchema = z.object({
    scriptName: z.string().optional(),
    scriptText: z.string().optional(),
    status: z.boolean().optional(),   
});