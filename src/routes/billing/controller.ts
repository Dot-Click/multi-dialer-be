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

export const createPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, monthlyAmount, yearlyAmount, currency = "usd", trialDays } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      errorResponse(res, "name is required", 400);
      return;
    }

    const hasMonthly = monthlyAmount !== undefined && monthlyAmount !== "" && Number(monthlyAmount) > 0;
    const hasYearly = yearlyAmount !== undefined && yearlyAmount !== "" && Number(yearlyAmount) > 0;

    if (!hasMonthly && !hasYearly) {
      errorResponse(res, "At least one of monthlyAmount or yearlyAmount is required", 400);
      return;
    }

    const planKey = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

    const product = await stripe.products.create({
      name: name.trim(),
      description: description ? String(description).trim() : undefined,
      active: true,
      metadata: {
        plan: planKey,
        ...(trialDays && Number.isInteger(Number(trialDays)) && Number(trialDays) > 0
          ? { trialDays: String(trialDays) }
          : {}),
      },
    });

    const createdPrices: any[] = [];

    if (hasMonthly) {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(Number(monthlyAmount)),
        currency: currency || "usd",
        recurring: { interval: "month" },
        nickname: `${name.trim()} Monthly`,
        metadata: { plan: planKey, interval: "month" },
      });
      createdPrices.push(price);
    }

    if (hasYearly) {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(Number(yearlyAmount)),
        currency: currency || "usd",
        recurring: { interval: "year" },
        nickname: `${name.trim()} Yearly`,
        metadata: { plan: planKey, interval: "year" },
      });
      createdPrices.push(price);
    }

    const serialized = serializeStripePlan(product, createdPrices);
    successResponse(res, 201, "Plan created successfully", serialized);
  } catch (error: any) {
    console.error("[Billing] Create Plan Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deletePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const productId = req.params.plan || "";
    if (!productId.startsWith("prod_")) {
      errorResponse(res, "Invalid Stripe product id", 400);
      return;
    }

    // Archive all active prices first
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
    await Promise.all(prices.data.map((p) => stripe.prices.update(p.id, { active: false })));

    // Archive the product (Stripe does not allow hard-deleting products with prices)
    await stripe.products.update(productId, { active: false });

    successResponse(res, 200, "Plan archived successfully", { id: productId });
  } catch (error: any) {
    console.error("[Billing] Delete Plan Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getFailedPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    // "past_due" is stored as a raw string by the invoice.payment_failed webhook (outside the enum)
    const records = await prisma.userSubscription.findMany({
      where: { status: "past_due" as any },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { updatedAt: "desc" },
    });

    const data = records.map((r) => ({
      id: r.id,
      userId: r.userId,
      plan: r.plan,
      amount: r.amount,
      failedAt: r.updatedAt.toISOString(),
      stripeCustomerId: r.stripeCustomerId,
      user: r.user,
    }));

    successResponse(res, 200, "Failed payments retrieved successfully", data);
  } catch (error: any) {
    console.error("[Billing] Get Failed Payments Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getUpcomingRenewals = async (req: Request, res: Response): Promise<void> => {
  try {
    const records = await prisma.userSubscription.findMany({
      where: { status: "ACTIVE" as any },
      include: { user: { select: { fullName: true, email: true } } },
    });

    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const upcoming = records
      .map((r) => {
        const start = new Date(r.startDate);
        const isYearly = r.billingCycle === "YEARLY";
        const next = new Date(start);

        // Advance to next future renewal anniversary
        while (next <= now) {
          if (isYearly) next.setFullYear(next.getFullYear() + 1);
          else next.setMonth(next.getMonth() + 1);
        }

        return {
          id: r.id,
          userId: r.userId,
          plan: r.plan,
          amount: r.amount,
          billingCycle: r.billingCycle,
          nextRenewalDate: next.toISOString(),
          user: r.user,
        };
      })
      .filter((r) => {
        const d = new Date(r.nextRenewalDate);
        return d >= now && d <= in30Days;
      })
      .sort((a, b) => new Date(a.nextRenewalDate).getTime() - new Date(b.nextRenewalDate).getTime());

    successResponse(res, 200, "Upcoming renewals retrieved successfully", upcoming);
  } catch (error: any) {
    console.error("[Billing] Get Upcoming Renewals Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getInvoicesByCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId } = req.query;

    if (!customerId || typeof customerId !== "string") {
      errorResponse(res, "customerId query param is required", 400);
      return;
    }

    const invoiceList = await stripe.invoices.list({ customer: customerId, limit: 20 });

    const invoices = invoiceList.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      amount_paid: inv.amount_paid,
      amount_due: inv.amount_due,
      status: inv.status,
      created: new Date(inv.created * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      hosted_invoice_url: inv.hosted_invoice_url,
      invoice_pdf: inv.invoice_pdf,
    }));

    successResponse(res, 200, "Invoices retrieved successfully", invoices);
  } catch (error: any) {
    console.error("[Billing] Get Invoices Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const changeSubscriptionPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const { newPriceId } = req.body;

    if (!subscriptionId || !newPriceId) {
      errorResponse(res, "subscriptionId and newPriceId are required", 400);
      return;
    }

    const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    if (!stripeSub || stripeSub.status === "canceled") {
      errorResponse(res, "Stripe subscription not found or already canceled", 404);
      return;
    }

    const existingItemId = stripeSub.items.data[0]?.id;
    if (!existingItemId) {
      errorResponse(res, "No subscription item found on this subscription", 400);
      return;
    }

    const updatedStripeSub = await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: existingItemId, price: newPriceId }],
      proration_behavior: "create_prorations",
    });

    // Resolve the new plan name from the price's product metadata
    const newPrice = await stripe.prices.retrieve(newPriceId, { expand: ["product"] });
    const product = newPrice.product as any;
    const newPlanKey = product?.metadata?.plan
      || product?.name?.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
      || "STARTER";

    const dbSub = await prisma.userSubscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (dbSub) {
      await prisma.userSubscription.update({
        where: { id: dbSub.id },
        data: { plan: newPlanKey as any },
      });
    }

    successResponse(res, 200, "Subscription plan updated successfully", {
      stripeSubscription: updatedStripeSub,
      newPlan: newPlanKey,
    });
  } catch (error: any) {
    console.error("[Billing] Change Subscription Plan Error:", error);
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
