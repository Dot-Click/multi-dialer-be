import Stripe from "stripe";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";
import { resolveBillableCustomer } from "./phoneNumberBilling.service";

function getStripeClient() {
  const key = envConfig.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

export class AgentSeatBillingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export { resolveBillableCustomer };

/** Counts how many of an admin's agents are currently paid-overage seats (not covered by the plan's included cap). */
export async function countPaidOverageSeats(adminUserId: string): Promise<number> {
  return prisma.user.count({
    where: { createdById: adminUserId, role: "AGENT", stripeAgentSeatItemId: { not: null } },
  });
}

/**
 * Adds one agent seat as a recurring monthly line item to the admin's
 * dedicated seat add-on subscription (creating that subscription on first
 * use), and immediately invoices/collects the current period's charge.
 * Throws on payment failure — callers must not create the agent.
 */
export async function addSeatToAddonSubscription(
  adminUserId: string,
  stripeCustomerId: string,
  paymentMethodId: string,
  monthlyPriceCents: number,
  currency: string = "usd",
): Promise<{ stripeSubscriptionItemId: string }> {
  const stripe = getStripeClient();

  // `price_data.product_data` (inline product creation) is only accepted by
  // the Prices API itself — subscriptions.create/subscriptionItems.create
  // reject it ("unknown parameter ... did you mean product?"). So create the
  // Price up front and reference it by id everywhere below.
  const price = await stripe.prices.create({
    currency,
    unit_amount: monthlyPriceCents,
    recurring: { interval: "month" },
    product_data: { name: "Extra Agent Seat", metadata: { internalAddon: "true" } },
  });

  let existing = await prisma.agentSeatSubscription.findUnique({ where: { userId: adminUserId } });

  if (!existing) {
    // First overage seat for this admin — create their dedicated subscription.
    // `error_if_incomplete` makes Stripe throw synchronously if the initial
    // charge fails, so the caller can avoid creating the agent.
    const stripeSub = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      default_payment_method: paymentMethodId,
      items: [{ price: price.id }],
      payment_behavior: "error_if_incomplete",
      collection_method: "charge_automatically",
      expand: ["latest_invoice.payment_intent"],
    });

    existing = await prisma.agentSeatSubscription.create({
      data: {
        userId: adminUserId,
        stripeCustomerId,
        stripeSubscriptionId: stripeSub.id,
        status: stripeSub.status,
      },
    });

    return { stripeSubscriptionItemId: stripeSub.items.data[0].id };
  }

  // Subsequent overage seat — add a new item to the existing subscription,
  // then immediately finalize + collect an invoice for it rather than
  // waiting for the next billing cycle.
  const item = await stripe.subscriptionItems.create({
    subscription: existing.stripeSubscriptionId,
    price: price.id,
    proration_behavior: "create_prorations",
  });

  try {
    const invoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      subscription: existing.stripeSubscriptionId,
      collection_method: "charge_automatically",
      auto_advance: true,
    });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);
    const paid = finalized.status === "paid"
      ? finalized
      : await stripe.invoices.pay(invoice.id!, { payment_method: paymentMethodId });

    if (paid.status !== "paid") {
      throw new AgentSeatBillingError("PAYMENT_FAILED", "Charge for this agent seat was not collected.");
    }
  } catch (err: any) {
    // Roll back the subscription item so the admin isn't left with an unpaid, active add-on.
    await stripe.subscriptionItems.del(item.id).catch(() => undefined);
    throw new AgentSeatBillingError("PAYMENT_FAILED", err.message || "Card was declined.");
  }

  return { stripeSubscriptionItemId: item.id };
}

/**
 * Confirms a `stripeSubscriptionItemId` presented at agent-creation time is a
 * genuine, unconsumed overage seat this admin already paid for via
 * addSeatToAddonSubscription — i.e. it belongs to their AgentSeatSubscription
 * and isn't already attached to another agent row. Called from the seat-cap
 * check right before Better Auth creates the new agent.
 */
export async function validatePurchasedAgentSeat(adminUserId: string, stripeSubscriptionItemId: string): Promise<boolean> {
  const sub = await prisma.agentSeatSubscription.findUnique({ where: { userId: adminUserId } });
  if (!sub) return false;

  const alreadyUsed = await prisma.user.findFirst({ where: { stripeAgentSeatItemId: stripeSubscriptionItemId } });
  if (alreadyUsed) return false;

  const stripe = getStripeClient();
  try {
    const item = await stripe.subscriptionItems.retrieve(stripeSubscriptionItemId);
    return item.subscription === sub.stripeSubscriptionId;
  } catch {
    return false;
  }
}

/** Cancels a single agent seat's subscription item (stops future billing for it). */
export async function removeAgentSeatSubscriptionItem(stripeSubscriptionItemId: string) {
  const stripe = getStripeClient();
  await stripe.subscriptionItems.del(stripeSubscriptionItemId, { proration_behavior: "none" }).catch((err: any) => {
    console.error(`[AgentSeatBilling] Failed to remove subscription item ${stripeSubscriptionItemId}:`, err.message);
  });
}

/** Cancels an admin's entire seat add-on subscription (used when they have no overage seats left, or their plan is canceled). */
export async function cancelAgentSeatSubscriptionForUser(adminUserId: string) {
  const record = await prisma.agentSeatSubscription.findUnique({ where: { userId: adminUserId } });
  if (!record) return;

  const stripe = getStripeClient();
  await stripe.subscriptions.cancel(record.stripeSubscriptionId).catch((err: any) => {
    console.error(`[AgentSeatBilling] Failed to cancel subscription ${record.stripeSubscriptionId}:`, err.message);
  });
  await prisma.agentSeatSubscription.delete({ where: { userId: adminUserId } }).catch(() => undefined);
}
