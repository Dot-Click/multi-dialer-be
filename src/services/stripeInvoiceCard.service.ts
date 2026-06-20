/**
 * Resolve the card used to pay a Stripe invoice. The exact location of the charge
 * shifts across Stripe API versions, so probe the common spots defensively and
 * never throw. Shared by the billing controller, the webhook, and the backfill.
 */
export async function resolveInvoiceCard(
  stripe: any,
  inv: any,
): Promise<{ brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null> {
  try {
    let chargeId: string | undefined;
    let paymentIntentId: string | undefined;
    let charge: any = null;

    // Legacy API (<= ~2024): the charge / payment intent sat on the invoice root.
    if (typeof inv.charge === "string") chargeId = inv.charge;
    else if (inv.charge?.id) chargeId = inv.charge.id;

    if (typeof inv.payment_intent === "string") paymentIntentId = inv.payment_intent;
    else if (inv.payment_intent?.id) paymentIntentId = inv.payment_intent.id;

    // Current API (2026-04-22.dahlia): invoice.charge / invoice.payment_intent no
    // longer exist — the payment is referenced via the invoice.payments list, each
    // entry's `payment` carrying a payment_intent or charge (string or expanded).
    if (!chargeId && !paymentIntentId && Array.isArray(inv.payments?.data)) {
      for (const p of inv.payments.data) {
        const pay = p?.payment;
        const pi = pay?.payment_intent;
        const ch = pay?.charge;
        if (pi) {
          paymentIntentId = typeof pi === "string" ? pi : pi.id;
        } else if (ch) {
          if (typeof ch === "string") chargeId = ch;
          else { chargeId = ch.id; charge = ch; }
        }
        if (paymentIntentId || chargeId) break;
      }
    }

    // Resolve the charge from the payment intent when we only have the latter.
    if (!chargeId && paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const latest = (pi as any).latest_charge;
      chargeId = typeof latest === "string" ? latest : latest?.id;
    }

    if (!charge) {
      if (!chargeId) return null;
      charge = await stripe.charges.retrieve(chargeId);
    }

    const card = (charge as any).payment_method_details?.card;
    if (!card) return null;

    return {
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
      expMonth: card.exp_month ?? null,
      expYear: card.exp_year ?? null,
    };
  } catch {
    return null;
  }
}
