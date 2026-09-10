/**
 * One-time migration: force trial accounts down to TRIAL_NUMBER_CAP caller-ids.
 *
 * Trials are now capped at TRIAL_NUMBER_CAP numbers. Accounts that were
 * provisioned before the cap existed can hold more; this releases the extras.
 * Keeps the OLDEST TRIAL_NUMBER_CAP numbers per account (by CallerId.createdAt
 * — the primary line provisioned at signup is always among them) and releases
 * the rest.
 *
 * Releasing a number at Twilio is PERMANENT — the number goes back to the pool
 * and cannot be reclaimed, so an account that loses a number their contacts
 * already know does not get it back. Dry-run is the default for that reason.
 *
 * Mirrors deleteAnyCallerId (routes/super-admin/caller-ids/controller.ts) so
 * released numbers are torn down exactly the way the product already does it:
 *   - release from the OWNING admin's Twilio sub-account
 *   - PAID_ADDON numbers also drop their Stripe subscription item, and the
 *     add-on subscription itself is cancelled once none remain
 *   - clear defaultCallerId on any user pointing at a released number
 *   - delete the local CallerId row
 *
 * Run (dry run, prints the plan and changes nothing):
 *   npx tsx scripts/force-release-trial-extras.ts
 * Canary a single account first:
 *   npx tsx scripts/force-release-trial-extras.ts --user someone@example.com --apply
 * Apply to everyone:
 *   npx tsx scripts/force-release-trial-extras.ts --apply
 */
import prisma from "../src/lib/prisma";
import { TRIAL_NUMBER_CAP } from "../src/constants/trial";
import { getTwilioClient, releaseNumber } from "../src/services/twilio-account.service";
import { isUserOnTrial } from "../src/utils/status";
import { removeAddonSubscriptionItem, cancelAddonSubscriptionForUser } from "../src/services/phoneNumberBilling.service";
import { loadEnv } from "./_env";
import { isProtectedAccount, listProtectedAccounts } from "./_protectedAccounts";

loadEnv();

const APPLY = process.argv.includes("--apply");
const userArg = (() => {
  const i = process.argv.indexOf("--user");
  return i !== -1 ? process.argv[i + 1] : undefined;
})();

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — capping trial accounts at ${TRIAL_NUMBER_CAP} caller-id(s).`);
  if (userArg) console.log(`Restricted to user: ${userArg}`);
  console.log(`Protected (never touched): ${listProtectedAccounts().join(", ")}`);

  const admins = await prisma.user.findMany({
    where: {
      role: "ADMIN",
      trialStatus: "ACTIVE",
      ...(userArg ? (userArg.includes("@") ? { email: userArg } : { id: userArg }) : {}),
    },
    select: {
      id: true,
      email: true,
      systemSettings: {
        select: {
          caller_id: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              label: true,
              twillioNumber: true,
              twillioSid: true,
              billingSource: true,
              stripeSubscriptionItemId: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  let accountsAffected = 0, released = 0, failed = 0;

  for (const admin of admins) {
    // Hard exclusion first — never inferred, never overridable.
    if (isProtectedAccount(admin.email)) {
      console.log(`\nPROTECTED ${admin.email} — on the do-not-touch list, skipping entirely.`);
      continue;
    }

    // The raw trialStatus flag is not enough: it goes stale whenever a
    // trialing→active webhook was missed, leaving paid accounts marked ACTIVE.
    // Reconcile through the same predicate the runtime guards use so this
    // script can never release a converted customer's numbers.
    if (!(await isUserOnTrial(admin.id))) {
      console.log(`\nSKIP ${admin.email} — trialStatus is ACTIVE but the subscription period says converted/paid.`);
      continue;
    }

    // Flatten across every System_Setting the admin owns, then order globally
    // by age so "keep the oldest N" is per-account, not per-setting.
    const all = admin.systemSettings
      .flatMap((s) => s.caller_id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    if (all.length <= TRIAL_NUMBER_CAP) continue;

    const keep = all.slice(0, TRIAL_NUMBER_CAP);
    const drop = all.slice(TRIAL_NUMBER_CAP);
    accountsAffected++;

    console.log(`\n${admin.email} — holds ${all.length}, releasing ${drop.length}`);
    console.log(`  KEEP: ${keep.map((c) => c.twillioNumber ?? c.label).join(", ")}`);

    for (const cid of drop) {
      const tag = `${cid.twillioNumber ?? cid.label}${cid.billingSource === "PAID_ADDON" ? " [PAID_ADDON]" : ""}`;

      if (!APPLY) {
        console.log(`  WOULD RELEASE: ${tag}`);
        released++;
        continue;
      }

      try {
        // If Twilio won't give the number up, do NOT delete the local row.
        // deleteAnyCallerId swallows this failure for a single interactive
        // delete, but doing that across a bulk run would orphan numbers that
        // are still live and still billing on the sub-account, with nothing
        // left in our DB pointing at them. Leave the row and report instead.
        if (cid.twillioSid) {
          const ownerClient = await getTwilioClient(admin.id);
          try {
            await releaseNumber(cid.twillioSid, ownerClient);
          } catch (err: any) {
            console.error(`  KEPT: ${tag} — Twilio release failed (${err.message}); local row left intact.`);
            failed++;
            continue;
          }
        }

        if (cid.billingSource === "PAID_ADDON" && cid.stripeSubscriptionItemId) {
          await removeAddonSubscriptionItem(cid.stripeSubscriptionItemId);
        }

        // The FK is optional, so Prisma would null it on delete anyway —
        // doing it explicitly keeps the intent visible and the log honest.
        const clearedDefaults = await prisma.user.updateMany({
          where: { defaultCallerId: cid.id },
          data: { defaultCallerId: null },
        });

        await prisma.callerId.delete({ where: { id: cid.id } });

        console.log(`  RELEASED: ${tag}${clearedDefaults.count ? ` (cleared default for ${clearedDefaults.count} user(s))` : ""}`);
        released++;
      } catch (err: any) {
        console.error(`  FAILED: ${tag} — ${err?.message}`);
        failed++;
      }
    }

    if (APPLY) {
      // Once the last PAID_ADDON number is gone the add-on subscription has
      // nothing left to bill — cancel it rather than leave a $0 shell open.
      const remainingAddons = await prisma.callerId.count({
        where: { billingSource: "PAID_ADDON", systemSetting: { userId: admin.id } },
      });
      if (remainingAddons === 0 && drop.some((c) => c.billingSource === "PAID_ADDON")) {
        await cancelAddonSubscriptionForUser(admin.id).catch((err: any) =>
          console.error(`  Add-on subscription cancel failed: ${err.message}`)
        );
        console.log(`  Cancelled empty phone-number add-on subscription.`);
      }
    }
  }

  console.log(`\n${APPLY ? "Released" : "Would release"}: ${released} number(s) across ${accountsAffected} account(s).   Failed: ${failed}`);
  if (!APPLY && released > 0) console.log(`Re-run with --apply to permanently release these ${released} number(s).`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
