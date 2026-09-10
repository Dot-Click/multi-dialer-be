import prisma from "../lib/prisma";
import { TRIAL_PERIOD_DAYS, TRIAL_STALE_FLAG_GRACE_DAYS, TRIAL_ENDING_SOON_EMAIL_ADVANCE_DAYS } from "../constants/trial";

/**
 * THE single source of truth for "what is this account's status?".
 *
 * Before this existed, six super-admin surfaces each derived status their own
 * way and disagreed with each other:
 *   - Home + User Management showed `User.status`, a manual field nothing
 *     automated ever wrote, so every account read ACTIVE regardless of billing.
 *   - The Subscription table derived a TRIAL badge from a predicate that is
 *     false for every real trial, so it never rendered.
 *   - Business Overview counted "active users" from `User.status` but "active
 *     subscriptions" from `UserSubscription.status`, so the two could never
 *     reconcile on the same screen.
 *   - Reporting styled a SUSPENDED case that `SubscriptionStatus` cannot hold.
 *
 * Everything that displays or counts account status now goes through here.
 *
 * TWO DISTINCT IDEAS, DELIBERATELY KEPT APART
 *
 *   Billing status  — trialing / active / payment failed / cancelling /
 *                     cancelled / never subscribed. Derived, never stored.
 *   Account state   — whether staff suspended the account. Stored on
 *                     `User.status`, and genuinely enforced at login and on
 *                     every request (auth.middleware.ts).
 *
 * `isSuspended` is reported alongside the billing status rather than replacing
 * it, so a suspended account can still be seen for what it was.
 *
 * WHY DERIVED RATHER THAN STORED
 *
 * `trialStatus` and `isSubscribed` are stored mirrors of Stripe state, written
 * only by webhooks — so a single missed delivery leaves them wrong forever, and
 * production already contains paid accounts still flagged as trialing. Deriving
 * from the subscription row's own status and dates is self-correcting.
 */

/** Days before the period end at which an account counts as expiring soon. */
export const EXPIRING_SOON_WINDOW_DAYS = 7;

export type AccountStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAYMENT_FAILED"
  | "CANCELLING"
  | "CANCELLED"
  | "NO_SUBSCRIPTION";

const LABELS: Record<AccountStatus, string> = {
  TRIALING: "Trialing",
  ACTIVE: "Active",
  PAYMENT_FAILED: "Payment failed",
  CANCELLING: "Cancelling",
  CANCELLED: "Cancelled",
  NO_SUBSCRIPTION: "No subscription",
};

/** The minimum shape needed to resolve a status. */
export interface AccountStatusInput {
  /** `User.status` — the manual moderation field. */
  status?: string | null;
  /** `User.trialStatus` — treated as a hint, not as truth. See below. */
  trialStatus?: string | null;
  /** The account's NEWEST subscription row, or null when it has none. */
  subscription?: { status?: string | null; endDate?: Date | string | null } | null;
}

export interface ResolvedAccountStatus {
  status: AccountStatus;
  /** Human label for the billing status — the one string every UI should show. */
  label: string;
  /** Staff suspended this account. Reported alongside, not instead of, `status`. */
  isSuspended: boolean;
  /** End of the current billing (or trial) period, when known. */
  periodEndsAt: Date | null;
  /** Whole days until `periodEndsAt`; null when unknown. Never negative. */
  daysRemaining: number | null;
  /** Live account whose period ends within EXPIRING_SOON_WINDOW_DAYS. */
  expiringSoon: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether an ACTIVE subscription is still inside its trial.
 *
 * `trialStatus === "ACTIVE"` is necessary but NOT sufficient. Two traps:
 *
 *  1. Do not also require `!isSubscribed`. The webhook treats a `trialing`
 *     subscription as live and sets `isSubscribed: true`, and signup does the
 *     same right after creating the user — so the intuitive
 *     `trialStatus === "ACTIVE" && !isSubscribed` is false for every genuine
 *     trial, and any guard built on it silently never fires.
 *
 *  2. The flag goes stale. It is only ever cleared by
 *     customer.subscription.updated, so an account whose trialing -> active
 *     transition was never delivered stays ACTIVE forever. A real trial's
 *     period ends within TRIAL_PERIOD_DAYS (Stripe pins current_period_end to
 *     trial_end while trialing), so a period ending well past that belongs to a
 *     converted, paying account whatever the flag says.
 */
function isWithinTrial(
  trialStatus: string | null | undefined,
  periodEndsAt: Date | null,
  now: Date,
): boolean {
  if (trialStatus !== "ACTIVE") return false;
  if (!periodEndsAt) return true; // No period to check — take the flag at face value.
  const staleAfter = now.getTime() + (TRIAL_PERIOD_DAYS + TRIAL_STALE_FLAG_GRACE_DAYS) * DAY_MS;
  return periodEndsAt.getTime() <= staleAfter;
}

/**
 * Resolve an account's status. Pure — pass an already-fetched user and its
 * newest subscription so list endpoints can resolve hundreds of rows without a
 * query per row.
 *
 * Precedence is deliberate: a locally-cancelled subscription whose period has
 * not elapsed yet is CANCELLING (still has access) rather than CANCELLED,
 * because the cancel flow marks the row CANCELLED immediately while Stripe
 * keeps it live until the period ends.
 */
export function resolveAccountStatus(
  input: AccountStatusInput,
  now: Date = new Date(),
): ResolvedAccountStatus {
  const isSuspended = String(input.status ?? "").toUpperCase() === "SUSPENDED";
  const periodEndsAt = toDate(input.subscription?.endDate ?? null);

  const daysRemaining = periodEndsAt
    ? Math.max(0, Math.ceil((periodEndsAt.getTime() - now.getTime()) / DAY_MS))
    : null;

  const subStatus = String(input.subscription?.status ?? "").toUpperCase();

  let status: AccountStatus;
  if (!input.subscription || !subStatus) {
    status = "NO_SUBSCRIPTION";
  } else if (subStatus === "PENDING") {
    // Stripe's past_due / unpaid / incomplete / paused all map to PENDING.
    // Surfaced as its own status because "their card is failing" is the one
    // state a super-admin needs to act on, and it used to read as "Pending".
    status = "PAYMENT_FAILED";
  } else if (subStatus === "CANCELLED" || subStatus === "CANCELED" || subStatus === "EXPIRED") {
    status = periodEndsAt && periodEndsAt.getTime() > now.getTime() ? "CANCELLING" : "CANCELLED";
  } else if (subStatus === "ACTIVE") {
    status = isWithinTrial(input.trialStatus, periodEndsAt, now) ? "TRIALING" : "ACTIVE";
  } else {
    status = "NO_SUBSCRIPTION";
  }

  // The window has to differ by status. A trial is only TRIAL_PERIOD_DAYS long,
  // so measuring it against the 7-day renewal window would flag every trial as
  // expiring from the moment it starts — the badge would carry no information.
  // Trials use the same threshold as the "trial ending soon" email, so the
  // badge appears exactly when the customer is told.
  const expiringSoonWindow =
    status === "TRIALING" ? TRIAL_ENDING_SOON_EMAIL_ADVANCE_DAYS : EXPIRING_SOON_WINDOW_DAYS;

  const expiringSoon =
    (status === "ACTIVE" || status === "TRIALING") &&
    daysRemaining !== null &&
    daysRemaining <= expiringSoonWindow;

  return {
    status,
    label: LABELS[status],
    isSuspended,
    periodEndsAt,
    daysRemaining,
    expiringSoon,
  };
}

/** The `select` a caller needs so its rows can be passed to resolveAccountStatus. */
export const ACCOUNT_STATUS_SELECT = {
  status: true,
  trialStatus: true,
  userSubscriptions: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { status: true, endDate: true },
  },
} as const;

/** Narrows a row fetched with ACCOUNT_STATUS_SELECT into resolver input. */
export function accountStatusInputFromUser(user: {
  status?: string | null;
  trialStatus?: string | null;
  userSubscriptions?: { status?: string | null; endDate?: Date | string | null }[];
}): AccountStatusInput {
  return {
    status: user.status,
    trialStatus: user.trialStatus,
    subscription: user.userSubscriptions?.[0] ?? null,
  };
}

/** Convenience single-user resolver. Prefer the pure form inside loops. */
export async function resolveAccountStatusForUser(
  userId: string,
): Promise<ResolvedAccountStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, createdById: true, ...ACCOUNT_STATUS_SELECT },
  });

  if (!user) {
    return resolveAccountStatus({ subscription: null });
  }

  // Subscriptions live on the account OWNER/ADMIN — agents inherit their
  // admin's billing, the same ownership rule getEffectiveLock and
  // getUserPlanLimits already follow. An agent's own suspension still counts.
  if (user.role === "AGENT" && user.createdById) {
    const admin = await prisma.user.findUnique({
      where: { id: user.createdById },
      select: ACCOUNT_STATUS_SELECT,
    });
    if (admin) {
      const resolved = resolveAccountStatus(accountStatusInputFromUser(admin));
      return {
        ...resolved,
        isSuspended: resolved.isSuspended || String(user.status ?? "").toUpperCase() === "SUSPENDED",
      };
    }
  }

  return resolveAccountStatus(accountStatusInputFromUser(user));
}

/**
 * Whether the account that owns this user is inside its trial — the one trial
 * check the rest of the backend should use (number caps, lifecycle emails).
 *
 * OWNER accounts are platform staff and never hold a trial of their own.
 */
export async function isUserOnTrial(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return false;
  if (user.role === "OWNER") return false;

  const resolved = await resolveAccountStatusForUser(userId);
  return resolved.status === "TRIALING";
}
