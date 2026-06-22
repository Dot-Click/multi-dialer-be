/**
 * One-time backfill: pull existing Stripe invoices and mirror them into the local
 * Billing ledger. Idempotent — safe to re-run (upserts on the Stripe invoice id).
 *
 * Run:  npx tsx scripts/backfillBilling.ts
 */
import fs from "fs";
import path from "path";
import Stripe from "stripe";
import prisma from "../src/lib/prisma";
import { syncBillingFromInvoice } from "../src/services/billingLedger.service";
import { resolveInvoiceCard } from "../src/services/stripeInvoiceCard.service";

// Load .env into process.env (no dotenv dependency required).
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// Map a Stripe invoice's own status to our Billing status. Returns null to skip
// (draft/void invoices aren't meaningful revenue rows).
function statusFor(invoice: any): "PAID" | "FAILED" | "PENDING" | null {
  switch (invoice.status) {
    case "paid":
      return "PAID";
    case "open":
      return "PENDING";
    case "uncollectible":
      return "FAILED";
    case "draft":
    case "void":
    default:
      return null;
  }
}

(async () => {
  loadEnv();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });

  let upserted = 0;
  let skipped = 0;
  let scanned = 0;
  let startingAfter: string | undefined;

  // Paginate through every invoice in the account.
  for (;;) {
    const page = await stripe.invoices.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const invoice of page.data) {
      scanned++;
      const status = statusFor(invoice as any);
      if (!status) { skipped++; continue; }

      // invoices.list can't expand the full payments chain (exceeds Stripe's
      // 4-level expand limit), so listed invoices carry no card. Re-fetch each
      // PAID invoice with the payment chain expanded so resolveInvoiceCard works.
      let full: any = invoice;
      if (status === "PAID" && invoice.id) {
        try {
          full = await stripe.invoices.retrieve(invoice.id, {
            expand: ["payments.data.payment.payment_intent"],
          });
        } catch { /* fall back to the listed invoice */ }
      }
      const card = status === "PAID" ? await resolveInvoiceCard(stripe, full) : null;
      const result = await syncBillingFromInvoice(full, status, card);
      if (result === "upserted") upserted++; else skipped++;
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  console.log(JSON.stringify({ scanned, upserted, skipped }, null, 2));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
