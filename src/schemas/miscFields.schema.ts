import { z } from "zod";

// Base schema with common fields
const baseMiscFieldSchema = z.object({
  fieldName: z.string().min(1, "Field name is required"),
});

// Text Field schema
const textFieldSchema = baseMiscFieldSchema.extend({
  type: z.literal("text"),
});

// Dropdown schema
const dropdownSchema = baseMiscFieldSchema.extend({
  type: z.literal("dropdown"),
  options: z.array(z.string().min(1, "Option cannot be empty")).min(1, "At least one option is required"),
});

// Counter schema
const counterSchema = baseMiscFieldSchema.extend({
  type: z.literal("counter"),
  countFrom: z.number().int("Count from must be an integer"),
  countTo: z.number().int("Count to must be an integer"),
}).refine((data) => data.countFrom < data.countTo, {
  message: "countFrom must be less than countTo",
  path: ["countTo"],
});

// Date schema
const dateSchema = baseMiscFieldSchema.extend({
  type: z.literal("date"),
  allowPastDates: z.boolean().optional().default(false),
});

// Discriminated union for create
export const createMiscFieldSchema = z.discriminatedUnion("type", [
  textFieldSchema,
  dropdownSchema,
  counterSchema,
  dateSchema,
]);

// Update schema - all fields optional, with conditional validation based on type
export const updateMiscFieldSchema = z.object({
  type: z.enum(["text", "dropdown", "counter", "date"]).optional(),
  fieldName: z.string().min(1).optional(),
  options: z.array(z.string().min(1)).optional(),
  countFrom: z.number().int().optional(),
  countTo: z.number().int().optional(),
  allowPastDates: z.boolean().optional(),
}).refine((data) => {
  // If type is "dropdown" and options are provided, ensure at least one option
  if (data.type === "dropdown" && data.options !== undefined) {
    return data.options.length >= 1;
  }
  return true;
}, {
  message: "Dropdown must have at least one option",
  path: ["options"],
}).refine((data) => {
  // If type is "counter" and both countFrom and countTo are provided, validate countFrom < countTo
  if (data.type === "counter" && data.countFrom !== undefined && data.countTo !== undefined) {
    return data.countFrom < data.countTo;
  }
  return true;
}, {
  message: "countFrom must be less than countTo",
  path: ["countTo"],
});

