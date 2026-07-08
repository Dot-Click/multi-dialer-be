import prisma from "../lib/prisma";

export interface PlanLimits {
  planKey: string | null;
  displayName: string | null;
  matched: boolean; // false when no PlanLimit row matched this plan (fail-open defaults used)
  maxDialerLines: number | null;
  includedAgentSeats: number | null;
  maxAgentSeats: number | null;
  includedNumbers: number | null;
  extraNumberPriceCents: number | null;
  callRecordingEnabled: boolean;
  aiInsightsLevel: string;
  stirShakenEnabled: boolean;
  smartNumberRotationEnabled: boolean;
  teamDashboardEnabled: boolean;
  priorityRoutingEnabled: boolean;
  aiCallCoachingEnabled: boolean;
  advancedDeliverabilityEnabled: boolean;
}

// Used whenever a user's plan has no matching PlanLimit row (e.g. subscribed
// before this system existed, on a trial, or a custom/renamed plan) — fully
// permissive so nobody is unexpectedly locked out by a missing config row.
const UNLIMITED_DEFAULTS: Omit<PlanLimits, "planKey" | "displayName" | "matched"> = {
  maxDialerLines: null,
  includedAgentSeats: null,
  maxAgentSeats: null,
  includedNumbers: null,
  extraNumberPriceCents: null,
  callRecordingEnabled: true,
  aiInsightsLevel: "FULL",
  stirShakenEnabled: true,
  smartNumberRotationEnabled: true,
  teamDashboardEnabled: true,
  priorityRoutingEnabled: true,
  aiCallCoachingEnabled: true,
  advancedDeliverabilityEnabled: true,
};

/**
 * Normalizes a Stripe product/plan display name into the same key used
 * everywhere else (planKeyFromProduct in billing/controller.ts, and the
 * `plan` metadata set on Stripe products at creation time).
 */
export function planKeyFromName(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Resolves the effective plan entitlements for a user — agents inherit their
 * owning admin's plan (same ownership rule as getEffectiveLock). Falls back
 * to unlimited defaults when no subscription or no matching PlanLimit row is
 * found, so a missing config never silently locks someone out.
 */
export async function getUserPlanLimits(userId: string): Promise<PlanLimits> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, createdById: true },
  });

  const effectiveUserId = user?.role === "AGENT" && user.createdById ? user.createdById : userId;

  const sub = await prisma.userSubscription.findFirst({
    where: { userId: effectiveUserId },
    orderBy: { createdAt: "desc" },
    select: { plan: true },
  });

  if (!sub?.plan) {
    return { planKey: null, displayName: null, matched: false, ...UNLIMITED_DEFAULTS };
  }

  const planKey = planKeyFromName(sub.plan);
  const limit = await prisma.planLimit.findUnique({ where: { planKey } });

  if (!limit) {
    return { planKey, displayName: sub.plan, matched: false, ...UNLIMITED_DEFAULTS };
  }

  return {
    planKey: limit.planKey,
    displayName: limit.displayName ?? sub.plan,
    matched: true,
    maxDialerLines: limit.maxDialerLines,
    includedAgentSeats: limit.includedAgentSeats,
    maxAgentSeats: limit.maxAgentSeats,
    includedNumbers: limit.includedNumbers,
    extraNumberPriceCents: limit.extraNumberPriceCents,
    callRecordingEnabled: limit.callRecordingEnabled,
    aiInsightsLevel: limit.aiInsightsLevel,
    stirShakenEnabled: limit.stirShakenEnabled,
    smartNumberRotationEnabled: limit.smartNumberRotationEnabled,
    teamDashboardEnabled: limit.teamDashboardEnabled,
    priorityRoutingEnabled: limit.priorityRoutingEnabled,
    aiCallCoachingEnabled: limit.aiCallCoachingEnabled,
    advancedDeliverabilityEnabled: limit.advancedDeliverabilityEnabled,
  };
}
