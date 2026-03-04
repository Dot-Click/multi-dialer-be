import { z } from "zod";

const parseDate = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return value;
}, z.date());

const optionalDate = parseDate.optional();

export const calendarEventType = z.enum(["START_ONLY", "FROM_TO", "ALL_DAY"]);

export const appointmentStatus = z.enum(["SET", "MET", "CANCELLED"]);

export const createCalendarEventSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    color: z.string(),
    eventType: calendarEventType,
    startDate: parseDate,
    endDate: optionalDate,
    assignToId: z.string().optional(),
    contactId: z.string().optional(),
    leadId: z.string().optional(),
    status: appointmentStatus.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.eventType === "FROM_TO" && !data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endDate is required when eventType is FROM_TO",
        path: ["endDate"],
      });
    }
  });

export const updateCalendarEventSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    eventType: calendarEventType.optional(),
    startDate: parseDate.optional(),
    endDate: optionalDate,
    contactId: z.string().optional(),
    leadId: z.string().optional(),
    status: appointmentStatus.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.eventType === "FROM_TO" && !data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endDate is required when eventType is FROM_TO",
        path: ["endDate"],
      });
    }
  });

