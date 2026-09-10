import prisma from "../lib/prisma";
import Stripe from "stripe";
import { envConfig } from "../lib/config";
import { cancelAddonSubscriptionForUser } from "./phoneNumberBilling.service";
import { cancelAgentSeatSubscriptionForUser } from "./agentSeatBilling.service";

/**
 * Billing teardown that runs when staff suspends an account.
 *
 * POLICY (chosen deliberately by the account owner — do not soften it without
 * asking, and do not "improve" it into a pause):
 *
 *   1. Cancellation is PERMANENT. Stripe subscriptions are cancelled outright,
 *      not paused via `pause_collection`. Un-suspending therefore does NOT
 *      restore billing: the customer has to subscribe again and re-enter
 *      payment details, on whatever plan exists at that time. This is why
 *      suspendAccountBilling is only ever called on the ACTIVE -> SUSPENDED
 *      transition, never on a re-save of an already-suspended account.
 *
 *   2. ALL FOUR revenue streams stop, not just the plan. An account can hold
 *      four independent Stripe subscriptions, and stopping only the plan would
 *      leave a suspended customer still being charged monthly for add-ons:
 *        - UserSubscription        the plan itself
 *        - PhoneNumberSubscription paid add-on numbers
 *        - AgentSeatSubscription   extra agent seats
 *        - LeadStore               one subscription per lead-store service
 *
 *   3. Twilio numbers are KEPT, not released. Releasing is irreversible —
 *      the number returns to Twilio's public pool and the same one cannot be
 *      reclaimed — and suspension is a moderation action that may be undone.
 *      The trade-off is explicit: the platform keeps paying Twilio for those
 *      numbers for as long as the account stays suspended, with no revenue
 *      against them. That cost ends only when the account is deleted.
 *
 * Every step is independently guarded. A failure on one stream is recorded and
 * the rest still run — a half-cancelled account that reports what it managed
 * is far easier to finish by hand than one that aborted at the first error.
 */

export interface SuspensionBillingResult {
  /** Human-readable lines describing what actually stopped. */
  cancelled: string[];
  /** Steps that failed, with the reason. Non-empty means manual follow-up. */
  failures: string[];
}

function getStripeClient() {
  const key = envConfig.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

/**
 * Cancels every Stripe subscription attached to the account and records the
 * local state changes. Never throws — inspect the returned `failures`.
 */
export async function suspendAccountBilling(userId: string): Promise<SuspensionBillingResult> {
  const cancelled: string[] = [];
  const failures: string[] = [];

  const stripe = (() => {
    try {
      return getStripeClient();
    } catch (err: any) {
      failures.push(`Stripe client unavailable: ${err.message}`);
      return null;
    }
  })();

  // ── 1. The plan subscription(s) ───────────────────────────────────────────
  // Resubscribes can leave more than one non-cancelled row behind, so cancel
  // every live one rather than just the newest.
  const planSubs = await prisma.userSubscription.findMany({
    where: { userId, status: { in: ["ACTIVE", "PENDING"] } },
    select: { id: true, stripeSubscriptionId: true, plan: true },
  });

  for (const sub of planSubs) {
    try {
      if (stripe && sub.stripeSubscriptionId) {
        const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
        if (live.status !== "canceled") {
          await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
        }
      }
      await prisma.userSubscription.update({
        where: { id: sub.id },
        data: { status: "CANCELLED", endDate: new Date() },
      });
      cancelled.push(`Plan subscription (${sub.plan})`);
    } catch (err: any) {
      failures.push(`Plan subscription ${sub.stripeSubscriptionId ?? sub.id}: ${err.message}`);
    }
  }

  // ── 2. Paid add-on phone numbers ──────────────────────────────────────────
  // Cancels the add-on subscription itself. The CallerId rows and the Twilio
  // numbers are left alone on purpose (policy note 3 above).
  try {
    const addon = await prisma.phoneNumberSubscription.findUnique({ where: { userId } });
    if (addon) {
      await cancelAddonSubscriptionForUser(userId);
      cancelled.push("Phone-number add-on subscription");
    }
  } catch (err: any) {
    failures.push(`Phone-number add-on subscription: ${err.message}`);
  }

  // ── 3. Extra agent seats ──────────────────────────────────────────────────
  try {
    const seats = await prisma.agentSeatSubscription.findUnique({ where: { userId } });
    if (seats) {
      await cancelAgentSeatSubscriptionForUser(userId);
      cancelled.push("Agent-seat subscription");
    }
  } catch (err: any) {
    failures.push(`Agent-seat subscription: ${err.message}`);
  }

  // ── 4. Lead Store ─────────────────────────────────────────────────────────
  // Each lead-store service is its own Stripe subscription on the same customer.
  const leadStores = await prisma.leadStore.findMany({
    where: { userId, stripeSubscriptionId: { not: null } },
    select: { id: true, stripeSubscriptionId: true },
  });

  for (const store of leadStores) {
    try {
      if (stripe && store.stripeSubscriptionId) {
        const live = await stripe.subscriptions.retrieve(store.stripeSubscriptionId);
        if (live.status !== "canceled") {
          await stripe.subscriptions.cancel(store.stripeSubscriptionId);
        }
      }
      await prisma.leadStore.update({
        where: { id: store.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      cancelled.push(`Lead Store subscription (${store.id})`);
    } catch (err: any) {
      failures.push(`Lead Store subscription ${store.stripeSubscriptionId ?? store.id}: ${err.message}`);
    }
  }

  // ── 5. Local access flags ─────────────────────────────────────────────────
  // With no subscription and no trial, isFeatureLocked locks the account out.
  // trialStatus goes to NONE rather than EXPIRED: the trial did not run its
  // course, it was terminated, and NONE is what stops the trial number-cap
  // guards from treating a suspended account as a live trial.
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { isSubscribed: false, trialStatus: "NONE" as any },
    });
  } catch (err: any) {
    failures.push(`Clearing access flags: ${err.message}`);
  }

  return { cancelled, failures };
}
