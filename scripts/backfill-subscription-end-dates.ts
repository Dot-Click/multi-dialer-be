/**
 * Backfill UserSubscription.endDate from Stripe.
 *
 * Nothing ever wrote this column, so the super-admin subscription table's
 * "End Date" showed "N/A" for every row. The Stripe webhooks now populate it
 * (see resolveSubscriptionEndDate in src/routes/webhooks/stripe.ts), but
 * existing rows stay null until their next subscription event — which for a
 * yearly plan can be months away. This fills them in now. Stripe is the
 * source of truth.
 *
 * Usage (from multi-dialer-be):
 *   Dry run (default — writes nothing, just reports):
 *     node --import=tsx --env-file=.env scripts/backfill-subscription-end-dates.ts
 *   Commit (actually write endDate):
 *     node --import=tsx --env-file=.env scripts/backfill-subscription-end-dates.ts --commit
 *   Optional: limit how many rows to process (useful for a test run):
 *     node --import=tsx --env-file=.env scripts/backfill-subscription-end-dates.ts --limit 5
 *   Optional: re-resolve rows that already have an endDate:
 *     node --import=tsx --env-file=.env scripts/backfill-subscription-end-dates.ts --all
 *
 * Notes:
 *  - Idempotent. By default only rows with endDate = null are touched; --all
 *    re-resolves every row (useful if a value was ever written wrong).
 *  - Rows with no stripeSubscriptionId are SKIPPED and listed (no invented dates).
 *  - A subscription Stripe no longer has (404) is SKIPPED, not nulled — deleting
 *    data on a bad lookup is worse than leaving the column blank.
 *  - `current_period_end` lives on the SubscriptionItem in API version
 *    2026-04-22.dahlia, NOT on Subscription. Reading it off the subscription
 *    object returns undefined and would silently backfill nothing.
 *  - MUST be run with the same Stripe mode (live/test) as the data you want, and
 *    against the database the app actually uses.
 */
import Stripe from "stripe";
import prisma from "../src/lib/prisma";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const ALL = args.includes("--all");
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

/**
 * Mirrors resolveSubscriptionEndDate in src/routes/webhooks/stripe.ts.
 * Keep the two in step — see the comment block there for why the precedence
 * is ended_at -> cancel_at -> item.current_period_end, and why the x1000 is
 * applied exactly once.
 */
function resolveSubscriptionEndDate(subscription: any, item?: any): Date | null {
  const seconds =
    subscription?.ended_at ??
    subscription?.cancel_at ??
    item?.current_period_end ??
    null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000);
}

async function main() {
  console.log(`Stripe mode: ${STRIPE_MODE}`);
  console.log(`Scope: ${ALL ? "ALL rows (re-resolving)" : "rows with endDate = null"}`);
  console.log(COMMIT ? "Mode: COMMIT (will write)\n" : "Mode: DRY RUN (writes nothing)\n");

  const rows = await prisma.userSubscription.findMany({
    where: ALL ? {} : { endDate: null },
    select: {
      id: true,
      plan: true,
      status: true,
      endDate: true,
      stripeSubscriptionId: true,
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`Found ${rows.length} row(s) to consider.\n`);

  const summary = {
    updated: 0,
    unchanged: 0,
    noSubscriptionId: [] as string[],
    notFoundInStripe: [] as string[],
    unresolved: [] as string[],
    errors: [] as string[],
  };

  for (const row of rows) {
    const who = row.user?.email || row.id;

    if (!row.stripeSubscriptionId) {
      summary.noSubscriptionId.push(who);
      console.log(`  ⏭️  ${who} — no stripeSubscriptionId, skipped`);
      continue;
    }

    try {
      const sub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      const item = sub.items?.data?.[0];
      const endDate = resolveSubscriptionEndDate(sub, item);

      if (!endDate) {
        summary.unresolved.push(who);
        console.log(`  ⚠️  ${who} — Stripe gave no usable end date, left as-is`);
        continue;
      }

      if (row.endDate && row.endDate.getTime() === endDate.getTime()) {
        summary.unchanged++;
        continue;
      }

      if (COMMIT) {
        await prisma.userSubscription.update({
          where: { id: row.id },
          data: { endDate },
        });
      }
      summary.updated++;
      console.log(
        `  ${COMMIT ? "✅" : "•"} ${who} — ${row.plan} (${row.status}) → ${endDate.toISOString().slice(0, 10)}`,
      );
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.code === "resource_missing") {
        summary.notFoundInStripe.push(who);
        console.log(`  ⏭️  ${who} — subscription not found in Stripe (${STRIPE_MODE}), skipped`);
      } else {
        summary.errors.push(`${who}: ${err?.message}`);
        console.error(`  ❌ ${who} — ${err?.message}`);
      }
    }

    // Stay well under Stripe's rate limit on large tenants.
    await sleep(120);
  }

  console.log("\n=== Summary ===");
  console.log(`  ${COMMIT ? "Updated" : "Would update"}: ${summary.updated}`);
  console.log(`  Already correct: ${summary.unchanged}`);
  console.log(`  No stripeSubscriptionId (skipped): ${summary.noSubscriptionId.length}`);
  if (summary.noSubscriptionId.length) console.log(`     → ${summary.noSubscriptionId.join(", ")}`);
  console.log(`  Not found in Stripe (skipped): ${summary.notFoundInStripe.length}`);
  if (summary.notFoundInStripe.length) console.log(`     → ${summary.notFoundInStripe.join(", ")}`);
  console.log(`  No usable date from Stripe (skipped): ${summary.unresolved.length}`);
  if (summary.unresolved.length) console.log(`     → ${summary.unresolved.join(", ")}`);
  console.log(`  Errors: ${summary.errors.length}`);
  if (summary.errors.length) summary.errors.forEach((e) => console.log(`     → ${e}`));
  if (!COMMIT) console.log(`\n(DRY RUN — nothing written. Re-run with --commit to apply.)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
