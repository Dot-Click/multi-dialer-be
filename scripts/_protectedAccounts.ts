/**
 * Accounts that the one-time trial migrations must never modify, whatever the
 * data says about them.
 *
 * This is a hard stop that sits ABOVE every other heuristic. The trial
 * migrations decide who to act on from `trialStatus`, reconciled against the
 * subscription period — but that reconciliation is inference, and inference
 * can flip when the underlying rows are corrected. An account listed here is
 * excluded unconditionally, so nothing can bring it back into scope by
 * accident.
 *
 * jason@henryhatton.com: explicitly ruled out of the trial migrations by the
 * account owner. Holds 57 caller-ids and carries a seeded, non-resolving
 * Stripe subscription id (sub_1testasdalkalksjkdlas) with a year-3026 period
 * end, so it is excluded by the stale-flag check today — but only as a side
 * effect of that bad data. Repairing those rows would silently make it a
 * target again. Hence this list.
 */
export const PROTECTED_ACCOUNT_EMAILS = [
  "jason@henryhatton.com",
] as const;

const normalized = new Set<string>(PROTECTED_ACCOUNT_EMAILS.map((e) => e.toLowerCase()));

/** Extra emails passed as `--exclude a@b.com,c@d.com`, merged with the list above. */
function cliExclusions(): string[] {
  const i = process.argv.indexOf("--exclude");
  if (i === -1 || !process.argv[i + 1]) return [];
  return process.argv[i + 1].split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

const allExcluded = new Set<string>([...normalized, ...cliExclusions()]);

export function isProtectedAccount(email: string | null | undefined): boolean {
  return !!email && allExcluded.has(email.toLowerCase());
}

export function listProtectedAccounts(): string[] {
  return [...allExcluded];
}
