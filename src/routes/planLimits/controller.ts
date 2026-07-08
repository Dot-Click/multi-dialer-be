import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import { getUserPlanLimits, planKeyFromName } from "../../services/planLimits.service";

/**
 * The current user's effective plan entitlements (agents resolve to their
 * owning admin's plan). Used by both the billing page's "Plan Limits" summary
 * and any frontend gate that needs to disable/cap something client-side.
 */
export const getMyPlanLimits = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      errorResponse(res, "Unauthorized", 401);
      return;
    }

    const limits = await getUserPlanLimits(userId);
    successResponse(res, 200, "Plan limits retrieved", limits);
  } catch (error: any) {
    console.error("[PlanLimits] Get My Plan Limits Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

/** Super-admin: every configured PlanLimit row. */
export const getAllPlanLimits = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.planLimit.findMany({ orderBy: { createdAt: "asc" } });
    successResponse(res, 200, "Plan limits retrieved", rows);
  } catch (error: any) {
    console.error("[PlanLimits] Get All Plan Limits Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

/**
 * Super-admin: create/update the entitlements for a plan. Keyed by the plan's
 * display name (e.g. the Stripe product name) — normalized into the same
 * planKey used everywhere else so it lines up with UserSubscription.plan.
 */
export const upsertPlanLimits = async (req: Request, res: Response): Promise<void> => {
  try {
    const { planName } = req.params;
    if (!planName) {
      errorResponse(res, "planName is required", 400);
      return;
    }

    const planKey = planKeyFromName(planName);
    const body = req.body || {};

    const numOrNull = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
    const boolOrDefault = (v: any, def: boolean) => (typeof v === "boolean" ? v : def);

    const data = {
      planKey,
      displayName: planName,
      maxDialerLines: numOrNull(body.maxDialerLines),
      includedAgentSeats: numOrNull(body.includedAgentSeats),
      maxAgentSeats: numOrNull(body.maxAgentSeats),
      includedNumbers: numOrNull(body.includedNumbers),
      extraNumberPriceCents: numOrNull(body.extraNumberPriceCents),
      callRecordingEnabled: boolOrDefault(body.callRecordingEnabled, true),
      aiInsightsLevel: ["NONE", "BASIC", "FULL"].includes(body.aiInsightsLevel) ? body.aiInsightsLevel : "FULL",
      stirShakenEnabled: boolOrDefault(body.stirShakenEnabled, true),
      smartNumberRotationEnabled: boolOrDefault(body.smartNumberRotationEnabled, true),
      teamDashboardEnabled: boolOrDefault(body.teamDashboardEnabled, true),
      priorityRoutingEnabled: boolOrDefault(body.priorityRoutingEnabled, true),
      aiCallCoachingEnabled: boolOrDefault(body.aiCallCoachingEnabled, true),
      advancedDeliverabilityEnabled: boolOrDefault(body.advancedDeliverabilityEnabled, true),
    };

    const saved = await prisma.planLimit.upsert({
      where: { planKey },
      update: data,
      create: data,
    });

    successResponse(res, 200, "Plan limits saved", saved);
  } catch (error: any) {
    console.error("[PlanLimits] Upsert Plan Limits Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
