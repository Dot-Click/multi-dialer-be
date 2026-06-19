/**
 * Backfill UserSubscription rows for users who onboarded BEFORE the
 * UserSubscription table existed (so they have a real Stripe subscription but
 * no local row). Stripe is the source of truth.
 *
 * Usage (from multi-dialer-be):
 *   Dry run (default — writes nothing, just reports):
 *     node --import=tsx --env-file=.env scripts/backfill-subscriptions.ts
 *   Commit (actually create rows):
 *     node --import=tsx --env-file=.env scripts/backfill-subscriptions.ts --commit
 *   Optional: limit how many users to process (useful for a test run):
 *     node --import=tsx --env-file=.env scripts/backfill-subscriptions.ts --limit 3
 *
 * Notes:
 *  - Idempotent: skips users that already have a UserSubscription, and skips any
 *    subscription whose stripeSubscriptionId is already stored.
 *  - amount is stored in WHOLE DOLLARS as a string (matches Plan.monthlyAmount
 *    and how the super-admin reporting sums revenue).
 *  - Users with no matching Stripe customer/subscription are SKIPPED and listed
 *    in the summary (no fabricated rows).
 *  - MUST be run with the same Stripe mode (live/test) as the data you want, and
 *    against the database the app actually uses.
 */
import Stripe from "stripe";
import prisma from "../src/lib/prisma";
import { SubscriptionStatus, BillingCycle } from "@prisma/client";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const INSPECT = args.includes("--inspect");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : undefined;

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error("STRIPE_SECRET_KEY is not set. Run with --env-file=.env");
  process.exit(1);
}
const STRIPE_MODE = stripeKey.startsWith("sk_live_")
  ? "LIVE"
  : stripeKey.startsWith("sk_test_")
    ? "TEST"
    : "UNKNOWN";
const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return SubscriptionStatus.ACTIVE;
    case "canceled":
      return SubscriptionStatus.CANCELLED;
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return SubscriptionStatus.PENDING;
    default:
      return SubscriptionStatus.ACTIVE;
  }
}

// Legacy enum values still sitting in the `plan` column from before it became
// free text — these are the rows the enrich pass should refresh.
const LEGACY_PLAN_VALUES = ["STARTER", "PROFESSIONAL", "ENTERPRISE"];

/** Pick the best subscription for a customer: prefer active/trialing, else newest. */
function pickSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subs.length === 0) return null;
  const active = subs.filter((s) => s.status === "active" || s.status === "trialing");
  const pool = active.length > 0 ? active : subs;
  return pool.sort((a, b) => b.created - a.created)[0];
}

async function findSubscriptionForEmail(email: string): Promise<Stripe.Subscription | null> {
  const customers = await stripe.customers.list({ email, limit: 100 });
  if (customers.data.length === 0) return null;

  let best: Stripe.Subscription | null = null;
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 100,
    });
    const picked = pickSubscription(subs.data);
    if (!picked) continue;
    // Prefer an active subscription across all matched customers.
    if (
      !best ||
      ((picked.status === "active" || picked.status === "trialing") &&
        best.status !== "active" &&
        best.status !== "trialing") ||
      picked.created > best.created
    ) {
      best = picked;
    }
    await sleep(120); // be gentle with Stripe rate limits
  }
  return best;
}

/**
 * Diagnostic: show what the Stripe key actually sees, and whether each target
 * admin's email matches a Stripe customer. Run with --inspect.
 */
async function inspect() {
  console.log(`\n=== Stripe INSPECT — key mode: ${STRIPE_MODE} ===\n`);

  // 1. What's in this Stripe account?
  const customers = await stripe.customers.list({ limit: 100 });
  const subs = await stripe.subscriptions.list({ status: "all", limit: 100, expand: ["data.customer"] });
  console.log(`Stripe account has ${customers.data.length} customer(s) and ${subs.data.length} subscription(s) (first 100).\n`);

  if (subs.data.length > 0) {
    console.log("Subscriptions in Stripe (customer email → status):");
    for (const s of subs.data) {
      const cust = s.customer as any;
      const email = typeof cust === "object" ? cust?.email : cust;
      const priceId = s.items.data[0]?.price?.id;
      console.log(`   • ${email ?? "(no email)"}  status=${s.status}  price=${priceId}  sub=${s.id}`);
    }
    console.log("");
  }

  // 2. Do our target admins match by email?
  const users = await prisma.user.findMany({
    where: { role: "ADMIN", userSubscriptions: { none: {} } },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("Target admins (DB email → Stripe customers found):");
  for (const u of users) {
    const matches = await stripe.customers.list({ email: u.email, limit: 10 });
    console.log(`   • ${u.email} → ${matches.data.length} customer(s)`);
    await sleep(120);
  }
  console.log(
    `\nIf the account counts above are 0, the key is the wrong mode/account. ` +
      `If subscriptions exist but under different emails, it's an email mismatch.\n`,
  );
  await prisma.$disconnect();
}

/**
 * Enrich EXISTING UserSubscription rows whose `plan` still holds a legacy enum
 * value (STARTER/PROFESSIONAL/ENTERPRISE) — rows created by the webhook before
 * `plan` carried the real product name. Uses the stored stripeSubscriptionId/
 * stripeCustomerId (no email matching) to pull the real product name from Stripe
 * and write it into `plan`.
 */
async function enrichExisting() {
  const rows = await prisma.userSubscription.findMany({
    where: {
      plan: { in: LEGACY_PLAN_VALUES },
      OR: [{ stripeSubscriptionId: { not: null } }, { stripeCustomerId: { not: null } }],
    },
    include: { user: { select: { email: true } } },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`--- Enrich pass: ${rows.length} existing row(s) still showing a legacy enum plan ---`);
  let updated = 0;
  for (const row of rows) {
    try {
      let sub: Stripe.Subscription | null = null;
      if (row.stripeSubscriptionId) {
        sub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      } else if (row.stripeCustomerId) {
        const subs = await stripe.subscriptions.list({ customer: row.stripeCustomerId, status: "all", limit: 100 });
        sub = pickSubscription(subs.data);
      }
      if (!sub) {
        console.log(`  ⏭  ${row.user?.email} — no Stripe subscription for stored ids`);
        continue;
      }

      const item = sub.items.data[0];
      const priceId = item?.price?.id;
      const quantity = item?.quantity ?? row.usersCount ?? 1;
      const billingCycle =
        item?.price?.recurring?.interval === "year" ? BillingCycle.YEARLY : BillingCycle.MONTHLY;
      const amountStr =
        typeof item?.price?.unit_amount === "number"
          ? String((item.price.unit_amount / 100) * quantity)
          : row.amount;

      let product: any = null;
      if (priceId) {
        const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
        product = price.product;
      }
      const planName: string | null = product?.name ?? null;
      const status = mapStatus(sub.status);

      console.log(
        `  ✅ ${row.user?.email} → "${planName ?? "?"}" (was ${row.plan}) amount=$${amountStr ?? "?"} seats=${quantity} status=${status}`,
      );

      if (COMMIT && planName) {
        await prisma.userSubscription.update({
          where: { id: row.id },
          data: { plan: planName, amount: amountStr, usersCount: quantity, billingCycle, status },
        });
        updated++;
      }
      await sleep(150);
    } catch (err: any) {
      console.error(`  ❌ ${row.user?.email} — ${err?.message}`);
    }
  }
  console.log(`  ${COMMIT ? "Updated" : "Would update"}: ${COMMIT ? updated : rows.length}\n`);
}

async function main() {
  if (INSPECT) return inspect();

  console.log(
    `\n=== UserSubscription backfill — Stripe ${STRIPE_MODE} — mode: ${COMMIT ? "COMMIT (writes)" : "DRY RUN (no writes)"}${
      LIMIT ? `, limit ${LIMIT}` : ""
    } ===\n`,
  );

  // Pass 1: fix existing rows that show the STARTER fallback.
  await enrichExisting();

  // Pass 2: create rows for users who have none at all.

  // Target: admins (the paying signups) with NO subscription row yet.
  const users = await prisma.user.findMany({
    where: { role: "ADMIN", userSubscriptions: { none: {} } },
    select: { id: true, email: true, fullName: true },
    orderBy: { createdAt: "asc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`Found ${users.length} admin(s) without a UserSubscription.\n`);

  const summary = {
    created: 0,
    skippedExisting: 0,
    noStripeMatch: [] as string[],
    errors: [] as string[],
  };

  for (const user of users) {
    try {
      const sub = await findSubscriptionForEmail(user.email);
      if (!sub) {
        summary.noStripeMatch.push(user.email);
        console.log(`  ⏭  ${user.email} — no Stripe customer/subscription found`);
        continue;
      }

      // Idempotency: don't duplicate a subscription we already stored.
      const exists = await prisma.userSubscription.findFirst({
        where: { stripeSubscriptionId: sub.id },
        select: { id: true },
      });
      if (exists) {
        summary.skippedExisting++;
        console.log(`  ⏭  ${user.email} — UserSubscription for ${sub.id} already exists`);
        continue;
      }

      const item = sub.items.data[0];
      const priceId = item?.price?.id;
      const quantity = item?.quantity ?? 1;
      const billingCycle =
        item?.price?.recurring?.interval === "year" ? BillingCycle.YEARLY : BillingCycle.MONTHLY;
      const amountStr =
        typeof item?.price?.unit_amount === "number"
          ? String((item.price.unit_amount / 100) * quantity)
          : null;

      // Resolve the actual Stripe product — its name goes straight into `plan`.
      let product: any = null;
      if (priceId) {
        const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
        product = price.product;
      }
      const plan: string = product?.name ?? "STARTER"; // real dynamic plan name
      const status = mapStatus(sub.status);
      const startDate = new Date(sub.start_date * 1000);
      const endDate = sub.canceled_at ? new Date(sub.canceled_at * 1000) : null;

      console.log(
        `  ✅ ${user.email} → "${plan}" cycle=${billingCycle} amount=$${amountStr ?? "?"} seats=${quantity} status=${status} sub=${sub.id}`,
      );

      if (COMMIT) {
        await prisma.$transaction([
          prisma.userSubscription.create({
            data: {
              userId: user.id,
              plan,
              status,
              startDate,
              endDate,
              stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
              stripeSubscriptionId: sub.id,
              amount: amountStr,
              usersCount: quantity,
              billingCycle,
            },
          }),
          prisma.user.update({
            where: { id: user.id },
            data: { isSubscribed: status === SubscriptionStatus.ACTIVE },
          }),
        ]);
        summary.created++;
      }

      await sleep(150);
    } catch (err: any) {
      summary.errors.push(`${user.email}: ${err?.message}`);
      console.error(`  ❌ ${user.email} — ${err?.message}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  ${COMMIT ? "Created" : "Would create"}: ${COMMIT ? summary.created : users.length - summary.skippedExisting - summary.noStripeMatch.length - summary.errors.length}`);
  console.log(`  Skipped (already had row for that sub): ${summary.skippedExisting}`);
  console.log(`  No Stripe match (skipped): ${summary.noStripeMatch.length}`);
  if (summary.noStripeMatch.length) console.log(`     → ${summary.noStripeMatch.join(", ")}`);
  console.log(`  Errors: ${summary.errors.length}`);
  if (summary.errors.length) summary.errors.forEach((e) => console.log(`     → ${e}`));
  if (!COMMIT) console.log(`\n(DRY RUN — nothing written. Re-run with --commit to apply.)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
