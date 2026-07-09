import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { getUserPlanLimits } from "../../services/planLimits.service";
import { resolveBillableCustomer, addSeatToAddonSubscription } from "../../services/agentSeatBilling.service";

/**
 * Self-service only: an admin at their plan's agent-seat cap pays for one
 * extra seat. Returns the resulting Stripe subscription-item id, which the
 * frontend must pass along on the immediately-following admin.createUser
 * call so the seat-cap check (auth.ts hook) recognizes it as already paid.
 */
export const purchaseAgentSeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;
    if (!userId) {
      errorResponse(res, "Unauthorized", 401);
      return;
    }
    if (role !== "ADMIN" && role !== "OWNER") {
      errorResponse(res, "Only an account admin can purchase an extra agent seat.", 403);
      return;
    }

    const limits = await getUserPlanLimits(userId);
    if (limits.extraAgentSeatPriceCents == null) {
      errorResponse(res, "Your plan doesn't offer paid overage agent seats. Upgrade your plan to add more agents.", 400);
      return;
    }

    const { stripeCustomerId, paymentMethodId } = await resolveBillableCustomer(userId);
    const { stripeSubscriptionItemId } = await addSeatToAddonSubscription(
      userId,
      stripeCustomerId,
      paymentMethodId,
      limits.extraAgentSeatPriceCents,
    );

    successResponse(res, 200, "Agent seat purchased", {
      stripeSubscriptionItemId,
      agentSeatMonthlyPriceCents: limits.extraAgentSeatPriceCents,
    });
  } catch (error: any) {
    console.error("[AgentSeats] Purchase Error:", error);
    if (error.code === "NO_STRIPE_CUSTOMER" || error.code === "NO_PAYMENT_METHOD" || error.code === "PAYMENT_FAILED") {
      errorResponse(res, error.message, 402);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
