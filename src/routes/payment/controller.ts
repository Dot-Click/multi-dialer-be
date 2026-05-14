import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { envConfig } from "../../lib/config";
import Stripe from "stripe";
import bcrypt from "bcryptjs";

// Initialize Stripe (requires STRIPE_SECRET_KEY in .env)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-04-22.dahlia",
});

export const createCheckoutSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, password, companyName, planId } = req.body;

    if (!fullName || !email || !password || !planId) {
      errorResponse(res, "Missing required fields: fullName, email, password, planId", 400);
      return;
    }

    // Hash password before sending it to Stripe metadata
    const hashedPassword = await bcrypt.hash(password, 10);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: planId, // The Stripe Price ID sent from frontend
          quantity: 1,
        },
      ],
      mode: "subscription",
      subscription_data: {
        trial_period_days: 30,
      },
      success_url: `${envConfig.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${envConfig.FRONTEND_URL}/signup`,
      metadata: {
        fullName,
        email,
        hashedPassword,
        companyName: companyName || "",
      },
    });

    if (!session.url) {
      errorResponse(res, "Failed to create Stripe session URL", 500);
      return;
    }

    successResponse(res, 200, "Checkout session created", { url: session.url });
  } catch (error: any) {
    console.error("[Stripe] Create Checkout Session Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
