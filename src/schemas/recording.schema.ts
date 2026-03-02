import { z } from "zod";

// slots correspond to RecordingSlot enum in Prisma schema
export const createRecordingSchema = z.object({
  name: z.string().min(1, "Recording name is required"),
  slot: z
    .enum(["ON_HOLD", "IVR", "ANSWERING_MACHINE", "GENERAL"])
    .optional(),
});

export const updateRecordingSchema = z
  .object({
    name: z.string().min(1).optional(),
    slot: z
      .enum(["ON_HOLD", "IVR", "ANSWERING_MACHINE", "GENERAL"])
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });
