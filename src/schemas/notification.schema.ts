import { z } from "zod";

// Base object for reuse
const notificationCore = {
  appointmentReminder: z.boolean().optional(),
  appointmentReminderEmail: z.string().email().optional().or(z.literal("")),
  callActivityReport: z.boolean().optional(),
  sessionSummaryReport: z.boolean().optional(),
  includeAgentsWithNoActivity: z.boolean().optional(),
  dailyCallReportEmail: z.string().email().optional().or(z.literal("")),
  appointmentNotification: z.boolean().optional(),
  complianceAlert: z.boolean().optional(),
  emailChannel: z.boolean().optional(),
  inAppChannel: z.boolean().optional(),
  reminderMinutes: z.number().int().min(0).optional(),
  followUpCallEvent: z.boolean().optional(),
  scheduledMeetingEvent: z.boolean().optional(),
};

export const createNotificationSchema = z.object({
  ...notificationCore
});

export const updateNotificationSchema = z.object({
  ...notificationCore
}).partial(); // Makes everything optional for updates