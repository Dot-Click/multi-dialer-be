/**
 * One-time migration: truncate in-flight trials to TRIAL_PERIOD_DAYS from now.
 *
 * Context: trials used to be 30 days and are now TRIAL_PERIOD_DAYS. The length
 * is baked into each Stripe subscription at creation, so existing trials keep
 * their original 30 days until they're rewritten here.
 *
 * What it does, per admin whose local trialStatus is ACTIVE:
 *   - reads the live Stripe subscription
 *   - skips anything not actually `trialing` in Stripe
 *   - skips any trial already ending on or before the target (never EXTENDS
 *     a trial — this can only ever shorten one)
 *   - sets trial_end to now + TRIAL_PERIOD_DAYS
 *
 * Stripe bills the customer at trial_end, so this moves each affected
 * customer's FIRST CHARGE forward. That is a customer-visible, effectively
 * irreversible billing change: re-extending afterwards does not un-send
 * Stripe's mails or un-charge a card. Dry-run is the default for that reason.
 *
 * Run (dry run, prints the plan and changes nothing):
 *   npx tsx scripts/truncate-trials.ts
 * Canary a single account first:
 *   npx tsx scripts/truncate-trials.ts --user someone@example.com --apply
 * Apply to everyone:
 *   npx tsx scripts/truncate-trials.ts --apply
 * Make one account's trial TRIAL_PERIOD_DAYS long measured from its signup:
 *   npx tsx scripts/truncate-trials.ts --user someone@example.com --from-signup --apply
 */
import Stripe from "stripe";
import prisma from "../src/lib/prisma";
import { TRIAL_PERIOD_DAYS } from "../src/constants/trial";
import { loadEnv } from "./_env";
import { isProtectedAccount, listProtectedAccounts } from "./_protectedAccounts";

loadEnv();

const APPLY = process.argv.includes("--apply");
const userArg = (() => {
  const i = process.argv.indexOf("--user");
  return i !== -1 ? process.argv[i + 1] : undefined;
})();
const limitArg = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : undefined;
})();

// Two different readings of "make the trial 5 days", and they are not the same
// date for an account that is already part-way through one:
//
//   default        trial_end = now + TRIAL_PERIOD_DAYS
//                  Everyone gets a full TRIAL_PERIOD_DAYS from today. Fair for
//                  a bulk migration — nobody's trial ends the moment you run it.
//
//   --from-signup  trial_end = createdAt + TRIAL_PERIOD_DAYS
//                  The trial becomes TRIAL_PERIOD_DAYS long in total, measured
//                  from when they signed up. This is what "his trial should be
//                  a 5-day trial" means for one specific account, and it is
//                  strictly shorter, so it is the more aggressive option.
//
// Accounts already past createdAt + TRIAL_PERIOD_DAYS cannot use --from-signup:
// Stripe rejects a trial_end in the past. Those are reported and skipped rather
// than silently falling back to a later date.
const FROM_SIGNUP = process.argv.includes("--from-signup");

function fmt(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set.");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-04-22.dahlia" });

  const now = new Date();
  const target = new Date(now.getTime() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const targetUnix = Math.floor(target.getTime() / 1000);

  console.log(
    FROM_SIGNUP
      ? `${APPLY ? "APPLY" : "DRY RUN"} — setting each trial to end ${TRIAL_PERIOD_DAYS} days after that account's signup.`
      : `${APPLY ? "APPLY" : "DRY RUN"} — truncating active trials to ${TRIAL_PERIOD_DAYS} days from now (${fmt(target)}).`,
  );
  if (userArg) console.log(`Restricted to user: ${userArg}`);
  console.log(`Protected (never touched): ${listProtectedAccounts().join(", ")}`);

  const subs = await prisma.userSubscription.findMany({
    where: {
      status: "ACTIVE",
      stripeSubscriptionId: { not: null },
      user: {
        role: "ADMIN",
        trialStatus: "ACTIVE",
        ...(userArg ? (userArg.includes("@") ? { email: userArg } : { id: userArg }) : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stripeSubscriptionId: true,
      endDate: true,
      user: { select: { id: true, email: true, createdAt: true } },
    },
  });

  // Resubscribes can leave more than one ACTIVE row per user; only ever touch
  // the newest one per account.
  const seen = new Set<string>();
  const candidates = subs.filter((s) => {
    if (seen.has(s.user.id)) return false;
    seen.add(s.user.id);
    return true;
  }).slice(0, limitArg ?? undefined);

  console.log(`Found ${candidates.length} local trial account(s) to inspect.\n`);

  let changed = 0, skipped = 0, failed = 0;

  for (const sub of candidates) {
    const label = `${sub.user.email} (${sub.stripeSubscriptionId})`;

    // Hard exclusion first — never inferred, never overridable.
    if (isProtectedAccount(sub.user.email)) {
      console.log(`PROT  ${label} — on the do-not-touch list, skipping entirely.`);
      skipped++;
      continue;
    }

    // Per-account target when measuring from signup.
    let rowTarget = target;
    let rowTargetUnix = targetUnix;
    if (FROM_SIGNUP) {
      rowTarget = new Date(sub.user.createdAt.getTime() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      rowTargetUnix = Math.floor(rowTarget.getTime() / 1000);
      if (rowTarget.getTime() <= now.getTime()) {
        console.log(`SKIP  ${label} — signed up ${fmt(sub.user.createdAt)}, so a ${TRIAL_PERIOD_DAYS}-day trial already ended; Stripe rejects a past trial_end.`);
        skipped++;
        continue;
      }
    }

    try {
      const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!);

      if (live.status !== "trialing") {
        console.log(`SKIP  ${label} — Stripe status is "${live.status}", not trialing.`);
        skipped++;
        continue;
      }
      if (!live.trial_end) {
        console.log(`SKIP  ${label} — trialing but no trial_end set.`);
        skipped++;
        continue;
      }
      if (live.trial_end <= rowTargetUnix) {
        console.log(`SKIP  ${label} — already ends ${fmt(new Date(live.trial_end * 1000))} (on/before target).`);
        skipped++;
        continue;
      }

      const from = fmt(new Date(live.trial_end * 1000));
      if (!APPLY) {
        console.log(`WOULD ${label} — trial_end ${from} -> ${fmt(rowTarget)}`);
        changed++;
        continue;
      }

      await stripe.subscriptions.update(sub.stripeSubscriptionId!, {
        trial_end: rowTargetUnix,
        proration_behavior: "none",
      });

      // Stripe fires customer.subscription.updated, and the webhook mirrors
      // endDate from the new period end. Write it here too so the "trial
      // ending soon" job is correct even if that webhook is unreachable from
      // wherever this script is run.
      await prisma.userSubscription.update({
        where: { id: sub.id },
        data: { endDate: rowTarget },
      });

      console.log(`OK    ${label} — trial_end ${from} -> ${fmt(rowTarget)}`);
      changed++;
    } catch (err: any) {
      console.error(`FAIL  ${label} — ${err?.message}`);
      failed++;
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Would change"}: ${changed}   Skipped: ${skipped}   Failed: ${failed}`);
  if (!APPLY && changed > 0) console.log(`Re-run with --apply to write these ${changed} change(s) to Stripe.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
