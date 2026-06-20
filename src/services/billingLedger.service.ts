import prisma from "../lib/prisma";

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
  const stripeSubscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;
  const periodEnd = line?.period?.end ? new Date(line.period.end * 1000) : null;
  const invoiceNumber = invoice.number || invoice.id;

  const data = {
    userId: sub.userId,
    invoiceNumber,
    plan: mapPlanEnum(planName) as any,
    planName,
    amount,
    date,
    status: status as any,
    billingCycle: billingCycle as any,
    usersCount: quantity,
    nextBillingDate: periodEnd,
    stripeSubscriptionId,
  };

  await prisma.billing.upsert({
    where: { stripeInvoiceId: invoice.id },
    update: data,
    create: { stripeInvoiceId: invoice.id, ...data },
  });
  return "upserted";
}
