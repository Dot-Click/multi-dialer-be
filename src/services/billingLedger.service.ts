import prisma from "../lib/prisma";

/**
 * All Stripe subscription ids for the internal add-on subscriptions
 * (PhoneNumberSubscription, AgentSeatSubscription) — never a customer-facing
 * "plan", just billing plumbing for overage numbers/seats. Anything reading
 * invoices/billing rows for display should exclude these so an add-on charge
 * never shows up looking like a separate subscription plan.
 */
export async function getAddonSubscriptionIds(): Promise<string[]> {
  const [numberSubs, seatSubs] = await Promise.all([
    prisma.phoneNumberSubscription.findMany({ select: { stripeSubscriptionId: true } }),
    prisma.agentSeatSubscription.findMany({ select: { stripeSubscriptionId: true } }),
  ]);
  return [...numberSubs.map(s => s.stripeSubscriptionId), ...seatSubs.map(s => s.stripeSubscriptionId)].filter(Boolean);
}

// Best-effort map of a dynamic Stripe product name to the fixed Plan enum.
export function mapPlanEnum(name?: string | null): "STARTER" | "PROFESSIONAL" | "ENTERPRISE" | null {
  const n = (name || "").toUpperCase();
  if (n.includes("ENTERPRISE")) return "ENTERPRISE";
  if (n.includes("PROFESSIONAL") || n.includes("PRO")) return "PROFESSIONAL";
  if (n.includes("STARTER") || n.includes("BASIC")) return "STARTER";
  return null;
}

/**
 * Mirror a Stripe invoice into the local Billing ledger. Idempotent: upserts on
 * the Stripe invoice id, so the same invoice (re-delivered webhook or re-run
 * backfill) updates one row. userId is resolved from the customer's
 * UserSubscription; if none exists we skip (Billing.userId is required).
 * Amounts are stored in cents (Stripe minor units).
 */
export async function syncBillingFromInvoice(
  invoice: any,
  status: "PAID" | "FAILED" | "PENDING" | "REFUNDED",
  card?: { brand: string | null; last4: string | null } | null,
): Promise<"upserted" | "skipped"> {
  if (!invoice?.id) return "skipped";
  const stripeCustomerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!stripeCustomerId) return "skipped";

  const sub = await prisma.userSubscription.findFirst({ where: { stripeCustomerId } });
  if (!sub) {
    console.warn(
      `[BillingLedger] skipped — no UserSubscription for customer ${stripeCustomerId} (invoice ${invoice.id})`,
    );
    return "skipped";
  }

  const stripeSubscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;

  // Never mirror an internal add-on subscription's invoice into the ledger —
  // it would get stamped with the main plan's name (sub.plan below) and show
  // up looking like a second "plan" purchase. Numbers/seats overage billing
  // has its own dedicated lifecycle handling; it doesn't belong in this table.
  if (stripeSubscriptionId) {
    const addonIds = await getAddonSubscriptionIds();
    if (addonIds.includes(stripeSubscriptionId)) {
      return "skipped";
    }
  }

  const line = invoice.lines?.data?.[0];
  const quantity = line?.quantity ?? sub.usersCount ?? 1;
  const interval = line?.price?.recurring?.interval ?? line?.plan?.interval;
  const billingCycle = interval === "year" ? "YEARLY" : "MONTHLY";
  const planName = sub.plan ?? null;
  const amount =
    status === "PAID" ? invoice.amount_paid ?? 0 : invoice.amount_due ?? invoice.amount_paid ?? 0;
  const paidAt = invoice.status_transitions?.paid_at;
  const ts = paidAt || invoice.created || Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000);
  const periodEnd = line?.period?.end ? new Date(line.period.end * 1000) : null;
  const invoiceNumber = invoice.number || invoice.id;

  // Only overwrite card columns when we actually resolved one (avoids wiping a
  // previously-stored card on a later non-card event for the same invoice).
  const cardFields =
    card && (card.brand || card.last4)
      ? { cardBrand: card.brand ?? null, cardLast4: card.last4 ?? null }
      : {};

  const data = {
    userId: sub.userId,
    invoiceNumber,
    plan: mapPlanEnum(planName) as any,
    planName,
    amount,
    currency: invoice.currency || "usd",
    date,
    status: status as any,
    billingCycle: billingCycle as any,
    usersCount: quantity,
    nextBillingDate: periodEnd,
    stripeSubscriptionId,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    ...cardFields,
  };

  await prisma.billing.upsert({
    where: { stripeInvoiceId: invoice.id },
    update: data,
    create: { stripeInvoiceId: invoice.id, ...data },
  });
  return "upserted";
}
