import { z } from "zod";


export const createCallbackPromptSchema = z.object({
  templateName: z
    .string()
    .min(1, "Template name is required")
    .max(255, "Template name must be 255 characters or less"),

  recordingType: z.enum(["VOICE_MAIL", "ON_HOLD", "EMAIL_VIDEO"] as const, {
  
    error: (issue: any) => {
    
      if (issue.code === z.ZodIssueCode.invalid_type) {
        return { message: "Recording type is required" };
      }

      
      return { message: "Invalid recording type" };
    },
  }),

  createdBy: z
    .string()
    .min(1, "Created by is required")
    .max(255, "Created by must be 255 characters or less"),
});


export const updateCallbackPromptSchema = createCallbackPromptSchema
  .partial() 
  
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field must be provided for update" }
  );


  
export type CreateCallbackPromptInput = z.infer<typeof createCallbackPromptSchema>;
export type UpdateCallbackPromptInput = z.infer<typeof updateCallbackPromptSchema>;