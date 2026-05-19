import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import Stripe from "stripe";

// Initialize Stripe (requires STRIPE_SECRET_KEY in .env)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-04-22.dahlia",
});

/**
 * 1. getBillingPortal
 * Fetch the current logged-in user from the database using their userId from the auth token
 * Look up their stripeCustomerId from the userSubscription table
 * If no stripeCustomerId exists, return a 400 error: "No Stripe customer found for this user"
 * Call stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: process.env.FRONTEND_URL })
 * Return the session url in the response as { url }
 */
export const getBillingPortal = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      errorResponse(res, "Unauthorized", 401);
      return;
    }

    const subscription = await prisma.userSubscription.findFirst({
      where: { userId },
      select: { stripeCustomerId: true },
    });

    const stripeCustomerId = subscription?.stripeCustomerId;

    if (!stripeCustomerId) {
      errorResponse(res, "No Stripe customer found for this user", 400);
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: process.env.FRONTEND_URL || "http://localhost:3000",
    });

    successResponse(res, 200, "Billing portal session created", { url: session.url });
  } catch (error: any) {
    console.error("[Billing] Get Billing Portal Session Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

/**
 * 2. getSubscriptions
 * Query prisma.userSubscription.findMany() and return all subscription records
 * Include related user info (name, email) in the response
 */
export const getSubscriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const subscriptions = await prisma.userSubscription.findMany({
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    successResponse(res, 200, "Subscriptions retrieved successfully", subscriptions);
  } catch (error: any) {
    console.error("[Billing] Get Subscriptions Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

/**
 * 3. getPlans
 * Return a hardcoded JSON array of the available plans with their Stripe Price IDs pulled from environment variables
 */
export const getPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const plans = [
      { name: "Basic", priceId: process.env.STRIPE_PRICE_BASIC || "" },
      { name: "Standard", priceId: process.env.STRIPE_PRICE_STANDARD || "" },
      { name: "Premium", priceId: process.env.STRIPE_PRICE_PREMIUM || "" },
    ];

    successResponse(res, 200, "Plans retrieved successfully", plans);
  } catch (error: any) {
    console.error("[Billing] Get Plans Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
