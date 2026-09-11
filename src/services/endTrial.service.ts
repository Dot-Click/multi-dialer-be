import Stripe from "stripe";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";
import { resolveAccountStatus } from "./accountStatus.service";

/**
 * Ends an account's free trial immediately, which bills the customer NOW.
 *
 * This is a one-way action, and the naming reflects that deliberately. Telling
 * Stripe `trial_end: "now"` makes it charge the card on the spot and email the
 * customer a receipt; switching a trial back on afterwards does not undo the
 * charge — that needs a manual refund. So this is exposed as "end trial and
 * bill now", never as a toggle that looks reversible.
 *
 * Only accounts actually on a trial can be billed this way. That is enforced
 * HERE, not only in the UI: without a server-side check, a direct API call
 * could charge someone who is already paying, or re-activate a subscription
 * the customer had cancelled.
 */

export type EndTrialFailureReason =
  | "USER_NOT_FOUND"
  | "NOT_ON_TRIAL"
  | "NO_STRIPE_SUBSCRIPTION"
  | "STRIPE_ERROR";

export type EndTrialResult =
  | {
      ok: true;
      email: string;
      /** What the customer was charged, as a display string (e.g. "197"). */
      amount: string | null;
      chargedAt: Date;
    }
  | { ok: false; reason: EndTrialFailureReason; message: string };

function getStripeClient() {
  const key = envConfig.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

export async function endTrialAndBillNow(userId: string): Promise<EndTrialResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      status: true,
      trialStatus: true,
      userSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, endDate: true, amount: true, stripeSubscriptionId: true },
      },
    },
  });

  if (!user) {
    return { ok: false, reason: "USER_NOT_FOUND", message: "User not found." };
  }

  const sub = user.userSubscriptions[0] ?? null;

  // The same resolver every status badge uses, so "is on a trial" means
  // exactly one thing across the product. It also rejects accounts whose
  // trialStatus flag is stale — those are paying customers, and billing them
  // again would take a second payment.
  const resolved = resolveAccountStatus({
    status: user.status,
    trialStatus: user.trialStatus,
    subscription: sub ? { status: sub.status, endDate: sub.endDate } : null,
  });

  if (resolved.status !== "TRIALING") {
    return {
      ok: false,
      reason: "NOT_ON_TRIAL",
      message: `This account is "${resolved.label}", not on a trial, so there is no trial to end.`,
    };
  }

  if (!sub?.stripeSubscriptionId) {
    return {
      ok: false,
      reason: "NO_STRIPE_SUBSCRIPTION",
      message: "This account has no Stripe subscription to bill.",
    };
  }

  try {
    const stripe = getStripeClient();

    // Re-check against Stripe before charging. The local flag can be stale in
    // either direction, and this is the last point at which a mistake is still
    // free — once the charge lands it can only be refunded.
    const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    if (live.status !== "trialing") {
      return {
        ok: false,
        reason: "NOT_ON_TRIAL",
        message: `Stripe reports this subscription as "${live.status}", not trialing — nothing was charged.`,
      };
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, { trial_end: "now" });

    const chargedAt = new Date();

    // Stripe fires customer.subscription.updated and the webhook clears
    // trialStatus. Written here as well so the UI is correct immediately, and
    // stays correct if that webhook cannot reach this environment.
    await prisma.userSubscription.update({
      where: { id: sub.id },
      data: { endDate: chargedAt },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { trialStatus: "NONE" as any, isSubscribed: true },
    });

    return { ok: true, email: user.email, amount: sub.amount, chargedAt };
  } catch (err: any) {
    return {
      ok: false,
      reason: "STRIPE_ERROR",
      message: err?.message ?? "Stripe rejected the request.",
    };
  }
}
