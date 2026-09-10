import prisma from "../lib/prisma";
import { planKeyFromName } from "./planLimits.service";
import { getUserTwilioSubAccountCredentials, purchaseUSPhoneNumber } from "./twilio-account.service";

/**
 * Tops an account up to the full number of caller-ids its plan includes.
 *
 * Signup only ever provisions TRIAL_NUMBER_CAP numbers (see the
 * checkout.session.completed handler), so an account converting off trial onto
 * a plan that includes more than that is short. This buys the difference, free,
 * as PLAN_INCLUDED numbers — the same kind signup creates.
 *
 * Idempotent by construction: it fills UP TO the plan's included count based on
 * what the account actually holds right now, rather than buying a fixed number
 * more. A duplicate webhook delivery, or a retry after a partial failure,
 * therefore buys only what is still missing and never double-provisions.
 *
 * Only ever call this on a genuine trial -> paid conversion. Calling it for an
 * established account would re-buy numbers the customer deliberately released.
 */
export async function provisionRemainingIncludedNumbers(
  userId: string,
  planName: string | null,
): Promise<{ bought: number; before: number; target: number }> {
  const noop = { bought: 0, before: 0, target: 0 };

  if (!planName) return noop;

  const planLimit = await prisma.planLimit.findUnique({
    where: { planKey: planKeyFromName(planName) },
  });

  // Same fail-open rule signup uses: a plan with no PlanLimit row, or a null
  // includedNumbers, means "no cap on what they may buy" — NOT "provision
  // unlimited". Nothing to top up in that case.
  if (!planLimit || planLimit.includedNumbers == null) return noop;

  const target = Math.max(0, planLimit.includedNumbers);

  const systemSettings = await prisma.system_Setting.findMany({
    where: { userId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (systemSettings.length === 0) return { ...noop, target };

  const before = await prisma.callerId.count({
    where: { systemSettingId: { in: systemSettings.map((s) => s.id) } },
  });

  const toBuy = target - before;
  if (toBuy <= 0) return { bought: 0, before, target };

  const creds = await getUserTwilioSubAccountCredentials(userId);
  if (!creds) {
    throw new Error(`No Twilio sub-account credentials found for user ${userId}.`);
  }

  let bought = 0;
  for (let i = 0; i < toBuy; i++) {
    const purchased = await purchaseUSPhoneNumber(creds.accountSid, creds.authToken);
    await prisma.callerId.create({
      data: {
        label: `Line ${before + i + 1} (${purchased.phoneNumber})`,
        countryCode: "US",
        twillioNumber: purchased.phoneNumber,
        twillioSid: purchased.sid,
        systemSettingId: systemSettings[0].id,
        numberOfLines: 1,
      },
    });
    bought++;
  }

  return { bought, before, target };
}
