import { z } from "zod";

/**
 * "HH:MM" on a 24-hour clock. These two values bound the TCPA calling window,
 * so a malformed one is a compliance problem rather than a cosmetic one — an
 * unparseable string would silently widen or close the window depending on how
 * the comparison falls out.
 */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a 24-hour time such as 08:00");

/**
 * Every field a client is allowed to set on the regulatory settings row.
 *
 * Unknown keys are stripped rather than written, and that is the whole point.
 * The update path used to pass `req.body` straight into
 * `prisma.regulatorySetting.update`, and Prisma's unchecked update input
 * accepts `systemSettingId` — so an authenticated admin could send another
 * tenant's `systemSettingId` and reparent their own regulatory row onto that
 * tenant's settings, handing them their TCPA hours and autodialing flag.
 * See slingvo-be#27.
 *
 * Everything here is optional because the frontend saves one control at a
 * time (`{ tcpaFrom: "08:00" }`, `{ companyTimeZone: "America/Chicago" }`).
 */
export const updateRegulatorySettingSchema = z.object({
  tcpaFrom: timeOfDay.optional(),
  tcpaTo: timeOfDay.optional(),
  tcpaAutodialing: z.boolean().optional(),

  gdprRetentionDays: z.number().int().min(1).max(3650).optional(),
  gdprDeleteRelated: z.boolean().optional(),

  // Lives on Company, not RegulatorySetting. The service splits it out and
  // canonicalises it against Intl.supportedValuesOf("timeZone") before
  // anything is written, so it is only loosely typed here.
  companyTimeZone: z.string().optional(),
});

export type UpdateRegulatorySettingInput = z.infer<typeof updateRegulatorySettingSchema>;
