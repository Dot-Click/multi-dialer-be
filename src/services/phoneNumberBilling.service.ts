import Stripe from "stripe";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";

function getStripeClient() {
  const key = envConfig.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

export class PhoneNumberBillingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Resolves the Stripe customer + default payment method that will be charged
 * for add-on phone numbers on a target user's behalf. Throws a descriptive
 * error if either is missing so callers can fail fast, before touching Twilio.
 */
export async function resolveBillableCustomer(userId: string): Promise<{ stripeCustomerId: string; paymentMethodId: string }> {
  const subscription = await prisma.userSubscription.findFirst({
    where: { userId, stripeCustomerId: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  if (!subscription?.stripeCustomerId) {
    throw new PhoneNumberBillingError("NO_STRIPE_CUSTOMER", "This user has no billing account on file.");
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(subscription.stripeCustomerId) as any;

  let paymentMethodId: string | undefined = typeof customer.invoice_settings?.default_payment_method === "string"
    ? customer.invoice_settings.default_payment_method
    : customer.invoice_settings?.default_payment_method?.id;

  if (!paymentMethodId) {
    const methods = await stripe.paymentMethods.list({ customer: subscription.stripeCustomerId, type: "card" });
    paymentMethodId = methods.data[0]?.id;
  }

  if (!paymentMethodId) {
    throw new PhoneNumberBillingError("NO_PAYMENT_METHOD", "This user has no payment method on file.");
  }

  return { stripeCustomerId: subscription.stripeCustomerId, paymentMethodId };
}

/**
 * Adds one phone number as a recurring monthly line item to the user's
 * dedicated add-on subscription (creating that subscription on first use),
 * and immediately invoices/collects the current period's charge.
 * Throws on payment failure — callers must roll back the Twilio purchase.
 */
export async function addNumberToAddonSubscription(
  userId: string,
  stripeCustomerId: string,
  paymentMethodId: string,
  monthlyPriceCents: number,
  currency: string,
  label: string,
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
    product_data: { name: `Phone Number Add-on — ${label}`, metadata: { internalAddon: "true" } },
  });

  let existing = await prisma.phoneNumberSubscription.findUnique({ where: { userId } });

  if (!existing) {
    // First add-on number for this user — create their dedicated subscription.
    // `error_if_incomplete` makes Stripe throw synchronously if the initial
    // charge fails, so the caller can roll back the Twilio purchase.
    const stripeSub = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      default_payment_method: paymentMethodId,
      items: [{ price: price.id }],
      payment_behavior: "error_if_incomplete",
      collection_method: "charge_automatically",
      expand: ["latest_invoice.payment_intent"],
    });

    existing = await prisma.phoneNumberSubscription.create({
      data: {
        userId,
        stripeCustomerId,
        stripeSubscriptionId: stripeSub.id,
        status: stripeSub.status,
      },
    });

    return { stripeSubscriptionItemId: stripeSub.items.data[0].id };
  }

  // Subsequent add-on number — add a new item to the existing subscription,
  // then immediately finalize + collect an invoice for it rather than waiting
  // for the next billing cycle.
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
      throw new PhoneNumberBillingError("PAYMENT_FAILED", "Charge for this number was not collected.");
    }
  } catch (err: any) {
    // Roll back the subscription item so the user isn't left with an unpaid, active add-on.
    await stripe.subscriptionItems.del(item.id).catch(() => undefined);
    throw new PhoneNumberBillingError("PAYMENT_FAILED", err.message || "Card was declined.");
  }

  return { stripeSubscriptionItemId: item.id };
}

/** Cancels a single add-on number's subscription item (stops future billing for it). */
export async function removeAddonSubscriptionItem(stripeSubscriptionItemId: string) {
  const stripe = getStripeClient();
  await stripe.subscriptionItems.del(stripeSubscriptionItemId, { proration_behavior: "none" }).catch((err: any) => {
    console.error(`[PhoneNumberBilling] Failed to remove subscription item ${stripeSubscriptionItemId}:`, err.message);
  });
}

/** Cancels a user's entire add-on subscription (used when they have no add-on numbers left, or their plan is canceled). */
export async function cancelAddonSubscriptionForUser(userId: string) {
  const record = await prisma.phoneNumberSubscription.findUnique({ where: { userId } });
  if (!record) return;

  const stripe = getStripeClient();
  await stripe.subscriptions.cancel(record.stripeSubscriptionId).catch((err: any) => {
    console.error(`[PhoneNumberBilling] Failed to cancel subscription ${record.stripeSubscriptionId}:`, err.message);
  });
  await prisma.phoneNumberSubscription.delete({ where: { userId } }).catch(() => undefined);
}

/** Looks up Twilio's current monthly list price (in cents) for a given country's local numbers. */
export async function getMonthlyPriceCentsForCountry(twilioClient: any, countryCode: string): Promise<{ amountCents: number; currency: string }> {
  const pricing = await twilioClient.pricing.v1.phoneNumbers.countries(countryCode).fetch();
  const priceEntry = pricing.phoneNumberPrices?.[0];
  const amount = parseFloat(priceEntry?.current_price ?? "1.15");
  const currency = (pricing.priceUnit || "usd").toLowerCase();
  return { amountCents: Math.round((isNaN(amount) ? 1.15 : amount) * 100), currency };
}
