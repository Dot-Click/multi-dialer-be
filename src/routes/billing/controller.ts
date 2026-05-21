import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import Stripe from "stripe";
import { envConfig } from "@/lib/config";

// Initialize Stripe (requires STRIPE_SECRET_KEY in .env)
const stripe = new Stripe(envConfig.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-04-22.dahlia",
});

function toCents(amount: number) {
  return Math.round(Number(amount) * 100);
}

function parseFeatures(metadataFeatures?: string | null) {
  if (!metadataFeatures) return [];
  try {
    const parsed = JSON.parse(metadataFeatures);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return metadataFeatures
      .split("\n")
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ text, enabled: true }));
  }
}

function planKeyFromProduct(product: any) {
  return product.metadata?.plan || product.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function serializeStripePlan(product: any, prices: any[]) {
  const monthly = prices.find((price) => price.recurring?.interval === "month");
  const yearly = prices.find((price) => price.recurring?.interval === "year");

  return {
    id: product.id,
    plan: planKeyFromProduct(product),
    name: product.name,
    displayName: product.name,
    description: product.description,
    monthlyAmount: (monthly?.unit_amount || 0) / 100,
    yearlyAmount: (yearly?.unit_amount || 0) / 100,
    currency: monthly?.currency || yearly?.currency || "usd",
    monthlyStripePriceId: monthly?.id || "",
    yearlyStripePriceId: yearly?.id || "",
    stripeProductId: product.id,
    priceId: monthly?.id || yearly?.id || "",
    features: parseFeatures(product.metadata?.features),
    isActive: product.active,
    isPopular: product.metadata?.isPopular === "true",
    createdAt: new Date(product.created * 1000).toISOString(),
    updatedAt: null,
  };
}

async function createStripePrice(params: {
  productId: string;
  displayName: string;
  plan: string;
  amountCents: number;
  currency: string;
  interval: "month" | "year";
}) {
  if (!envConfig.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required to sync pricing tiers to Stripe.");
  }

  return stripe.prices.create({
    product: params.productId,
    unit_amount: params.amountCents,
    currency: params.currency,
    recurring: { interval: params.interval },
    nickname: `${params.displayName} ${params.interval === "month" ? "Monthly" : "Yearly"}`,
    metadata: {
      plan: params.plan,
      interval: params.interval,
    },
  });
}

async function getStripePlans() {
  if (!envConfig.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required to load pricing tiers from Stripe.");
  }

  const products = await stripe.products.list({ limit: 100 });

  const plans = await Promise.all(
    products.data.map(async (product) => {
      const prices = await stripe.prices.list({
        product: product.id,
        active: true,
        type: "recurring",
        limit: 100,
      });
      return serializeStripePlan(product, prices.data);
    }),
  );

  return plans.filter((plan) => plan.monthlyStripePriceId || plan.yearlyStripePriceId);
}

async function syncProductToStripe(existing: ReturnType<typeof serializeStripePlan>, next: any) {
  const product = await stripe.products.retrieve(existing.stripeProductId);
  const oldPriceIdsToArchive: string[] = [];

  await stripe.products.update(existing.stripeProductId, {
    name: next.displayName,
    active: next.isActive,
    description: next.description,
    metadata: {
      ...product.metadata,
      plan: next.plan,
      isPopular: String(next.isPopular),
      features: JSON.stringify(next.features),
    },
  });

  let monthlyStripePriceId = existing.monthlyStripePriceId;
  let yearlyStripePriceId = existing.yearlyStripePriceId;

  if (!monthlyStripePriceId || toCents(existing.monthlyAmount) !== next.monthlyAmount) {
    if (monthlyStripePriceId) {
      oldPriceIdsToArchive.push(monthlyStripePriceId);
    }
    const price = await createStripePrice({
      productId: existing.stripeProductId,
      displayName: next.displayName,
      plan: next.plan,
      amountCents: next.monthlyAmount,
      currency: next.currency,
      interval: "month",
    });
    monthlyStripePriceId = price.id;
  }

  if (!yearlyStripePriceId || toCents(existing.yearlyAmount) !== next.yearlyAmount) {
    if (yearlyStripePriceId) {
      oldPriceIdsToArchive.push(yearlyStripePriceId);
    }
    const price = await createStripePrice({
      productId: existing.stripeProductId,
      displayName: next.displayName,
      plan: next.plan,
      amountCents: next.yearlyAmount,
      currency: next.currency,
      interval: "year",
    });
    yearlyStripePriceId = price.id;
  }

  await stripe.products.update(existing.stripeProductId, {
    default_price: monthlyStripePriceId,
    metadata: {
      ...product.metadata,
      plan: next.plan,
      isPopular: String(next.isPopular),
      features: JSON.stringify(next.features),
      monthlyStripePriceId,
      yearlyStripePriceId,
    },
  });

  for (const priceId of oldPriceIdsToArchive) {
    if (priceId !== monthlyStripePriceId && priceId !== yearlyStripePriceId) {
      await stripe.prices.update(priceId, { active: false });
    }
  }

  const updatedProduct = await stripe.products.retrieve(existing.stripeProductId);
  const prices = await stripe.prices.list({
    product: existing.stripeProductId,
    active: true,
    type: "recurring",
    limit: 100,
  });

  return serializeStripePlan(updatedProduct, prices.data);
}

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
      return_url: envConfig.FRONTEND_URL || "http://localhost:5000",
    configuration: envConfig.STRIPE_BILLING_PORTAL_CONFIG || undefined,
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
 * Return available billing plans from Stripe Products and active recurring Prices.
 */
export const getPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const plans = await getStripePlans();
    successResponse(res, 200, "Stripe plans retrieved successfully", plans);
  } catch (error: any) {
    console.error("[Billing] Get Plans Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const updatePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const productId = req.params.plan || "";
    if (!productId.startsWith("prod_")) {
      errorResponse(res, "Invalid Stripe product id.", 400);
      return;
    }

    const {
      displayName,
      monthlyAmount,
      yearlyAmount,
      features,
      isActive,
      isPopular,
      description,
    } = req.body;

    if (!displayName || typeof displayName !== "string") {
      errorResponse(res, "displayName is required", 400);
      return;
    }

    if (!Number.isFinite(Number(monthlyAmount)) || Number(monthlyAmount) <= 0) {
      errorResponse(res, "monthlyAmount must be a positive number", 400);
      return;
    }

    if (!Number.isFinite(Number(yearlyAmount)) || Number(yearlyAmount) <= 0) {
      errorResponse(res, "yearlyAmount must be a positive number", 400);
      return;
    }

    if (!Array.isArray(features)) {
      errorResponse(res, "features must be an array", 400);
      return;
    }

    const product = await stripe.products.retrieve(productId);
    const currentPrices = await stripe.prices.list({
      product: productId,
      active: true,
      type: "recurring",
      limit: 100,
    });
    const existing = serializeStripePlan(product, currentPrices.data);

    const next = {
      plan: existing.plan,
      displayName: displayName.trim(),
      monthlyAmount: toCents(Number(monthlyAmount)),
      yearlyAmount: toCents(Number(yearlyAmount)),
      currency: existing.currency || "usd",
      features: features.map((feature: any) => ({
        text: String(feature.text || "").trim(),
        enabled: Boolean(feature.enabled),
      })).filter((feature: any) => feature.text.length > 0),
      isActive: Boolean(isActive),
      isPopular: Boolean(isPopular),
      description: description ? String(description) : null,
    };

    const updated = await syncProductToStripe(existing, next);

    successResponse(res, 200, "Plan updated in Stripe", updated);
  } catch (error: any) {
    console.error("[Billing] Update Plan Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
