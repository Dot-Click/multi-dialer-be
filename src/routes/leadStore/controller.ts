import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import { getStripeClient } from "../../lib/stripe";
import { envConfig } from "../../lib/config";
import { notifyClients } from "../../services/leadStoreNotify.service";

export const listLeadStoreServices = async (_req: Request, res: Response): Promise<void> => {
  try {
    const services = await prisma.leadStoreService.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    successResponse(res, 200, "Lead Store services fetched", services);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

export const listMyLeadStoreSubscriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const subscriptions = await prisma.leadStore.findMany({
      where: { userId },
      include: { service: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    successResponse(res, 200, "Lead Store subscriptions fetched", subscriptions);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

export const subscribeToLeadStoreService = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { serviceId } = req.body;
    if (!serviceId || typeof serviceId !== "string") {
      errorResponse(res, "serviceId is required", 400);
      return;
    }

    const service = await prisma.leadStoreService.findUnique({ where: { id: serviceId } });
    if (!service || !service.isActive) {
      errorResponse(res, "Lead Store service not found", 404);
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) {
      errorResponse(res, "User not found", 404);
      return;
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: service.name },
            recurring: { interval: "month" },
            unit_amount: service.price,
          },
          quantity: 1,
        },
      ],
      customer_email: user.email,
      success_url: `${envConfig.FRONTEND_URL}/admin/lead-store?checkout=success`,
      cancel_url: `${envConfig.FRONTEND_URL}/admin/lead-store`,
      metadata: {
        userId,
        leadStoreServiceId: serviceId,
        purpose: "lead_store",
      },
    });

    if (!session.url) {
      errorResponse(res, "Failed to create Stripe checkout session", 500);
      return;
    }

    successResponse(res, 200, "Checkout session created", { url: session.url });
  } catch (error: any) {
    console.error("[LeadStore] Subscribe error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const cancelLeadStoreSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const leadStore = await prisma.leadStore.findFirst({
      where: { id, userId },
      include: { user: { select: { fullName: true, email: true } }, service: { select: { name: true } } },
    });
    if (!leadStore) {
      errorResponse(res, "Subscription not found", 404);
      return;
    }

    if (leadStore.stripeSubscriptionId) {
      await getStripeClient().subscriptions.cancel(leadStore.stripeSubscriptionId).catch((err: any) => {
        console.warn("[LeadStore] Stripe cancel failed (may already be cancelled):", err.message);
      });
    }

    const updated = await prisma.leadStore.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await notifyClients(
      "Customer cancelled a Lead Store subscription",
      `${leadStore.user.fullName || leadStore.user.email} cancelled "${leadStore.service.name}". Disable it on your MyPlusLeads account when convenient.`,
      "lead_store_cancelled",
    ).catch((err) => console.error("[LeadStore] Notify failed:", err));

    successResponse(res, 200, "Subscription cancelled", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
