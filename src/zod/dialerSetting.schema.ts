import { z } from "zod";

// Helper regex to ensure time is in HH:mm format (e.g., "10:00", "06:00")
const timeFormat = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const createDialerSettingSchema = z.object({
  useTimeShield: z.boolean().optional(),
  timeShieldStartTime: z
    .string()
    .regex(timeFormat, "Start time must be in HH:mm format")
    .optional()
    .nullable(),
  timeShieldEndTime: z
    .string()
    .regex(timeFormat, "End time must be in HH:mm format")
    .optional()
    .nullable(),
  useAnswerNotificationTone: z.boolean().optional(),
  deleteDisconnectedNumbers: z.boolean().optional(),
  deleteFaxNumbers: z.boolean().optional(),
  useCallSessionTimer: z.boolean().optional(),
});

export const updateDialerSettingSchema = z.object({
  useTimeShield: z.boolean().optional(),
  timeShieldStartTime: z
    .string()
    .regex(timeFormat, "Start time must be in HH:mm format")
    .optional()
    .nullable(),
  timeShieldEndTime: z
    .string()
    .regex(timeFormat, "End time must be in HH:mm format")
    .optional()
    .nullable(),
  useAnswerNotificationTone: z.boolean().optional(),
  deleteDisconnectedNumbers: z.boolean().optional(),
  deleteFaxNumbers: z.boolean().optional(),
  useCallSessionTimer: z.boolean().optional(),
});