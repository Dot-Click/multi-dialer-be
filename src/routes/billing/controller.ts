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

    const productNames = await resolveProductNames(invoiceList.data);

    const invoices = invoiceList.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      plan: planFromInvoice(inv, productNames) ?? "—",
      amount_paid: inv.amount_paid,
      amount_due: inv.amount_due,
      currency: inv.currency,
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

export const getAllInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    // Build a lookup of every signed-up customer keyed by their Stripe customer id
    const subscriptions = await prisma.userSubscription.findMany({
      where: { stripeCustomerId: { not: null } },
      include: { user: { select: { fullName: true, email: true } } },
    });

    const customerMap = new Map<
      string,
      { userId: string; fullName: string | null; email: string | null; plan: string }
    >();
    for (const sub of subscriptions) {
      if (sub.stripeCustomerId && !customerMap.has(sub.stripeCustomerId)) {
        customerMap.set(sub.stripeCustomerId, {
          userId: sub.userId,
          fullName: sub.user?.fullName ?? null,
          email: sub.user?.email ?? null,
          plan: String(sub.plan),
        });
      }
    }

    // Pull all account invoices via a single paginated list call (cap to avoid runaway).
    // Expand the customer so we can label invoices even when they aren't linked to a
    // platform subscription record (e.g. invoices created directly in Stripe).
    const MAX_INVOICES = 300;
    const collected: Awaited<ReturnType<typeof stripe.invoices.list>>["data"] = [];
    let startingAfter: string | undefined;

    while (collected.length < MAX_INVOICES) {
      const page = await stripe.invoices.list({
        limit: 100,
        expand: ["data.customer"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      collected.push(...page.data);
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    const productNames = await resolveProductNames(collected);

    // Show every invoice in the connected Stripe account, enriching with platform
    // customer details when a matching subscription exists.
    const invoices = collected.map((inv) => {
      const customerObj = inv.customer && typeof inv.customer === "object" ? inv.customer : null;
      const customerId =
        typeof inv.customer === "string" ? inv.customer : customerObj?.id ?? "";
      const matched = customerId ? customerMap.get(customerId) : undefined;

      // Fall back to the Stripe customer's own name/email, then the invoice's billing fields
      const stripeName = customerObj && !("deleted" in customerObj) ? customerObj.name : null;
      const stripeEmail = customerObj && !("deleted" in customerObj) ? customerObj.email : null;

      return {
        id: inv.id,
        number: inv.number,
        customerId,
        customerName: matched?.fullName ?? stripeName ?? inv.customer_name ?? null,
        customerEmail: matched?.email ?? stripeEmail ?? inv.customer_email ?? null,
        plan: planFromInvoice(inv, productNames) ?? matched?.plan ?? "—",
        amount_paid: inv.amount_paid,
        amount_due: inv.amount_due,
        currency: inv.currency,
        status: inv.status,
        createdAt: new Date(inv.created * 1000).toISOString(),
        created: new Date(inv.created * 1000).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
      };
    });

    // Derive the active Stripe environment from the secret key prefix
    const mode: "live" | "test" = (envConfig.STRIPE_SECRET_KEY || "").startsWith("sk_live_")
      ? "live"
      : "test";

    successResponse(res, 200, "All invoices retrieved successfully", { mode, invoices });
  } catch (error: any) {
    console.error("[Billing] Get All Invoices Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

/**
 * Resolve the card used to pay an invoice. The exact location of the charge shifts
 * across Stripe API versions, so probe the common spots defensively and never throw.
 */
async function resolveInvoiceCard(inv: any): Promise<{
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
} | null> {
  try {
    let chargeId: string | undefined;

    if (typeof inv.charge === "string") {
      chargeId = inv.charge;
    } else if (inv.charge?.id) {
      chargeId = inv.charge.id;
    }

    // payments list (newer API): pull the payment intent, then its latest charge
    let paymentIntentId: string | undefined =
      typeof inv.payment_intent === "string" ? inv.payment_intent : inv.payment_intent?.id;

    if (!paymentIntentId && Array.isArray(inv.payments?.data)) {
      for (const p of inv.payments.data) {
        const pi = p?.payment?.payment_intent ?? p?.payment_intent;
        if (typeof pi === "string") {
          paymentIntentId = pi;
          break;
        }
      }
    }

    if (!chargeId && paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const latest = (pi as any).latest_charge;
      chargeId = typeof latest === "string" ? latest : latest?.id;
    }

    if (!chargeId) return null;

    const charge = await stripe.charges.retrieve(chargeId);
    const card = (charge as any).payment_method_details?.card;
    if (!card) return null;

    return {
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
      expMonth: card.exp_month ?? null,
      expYear: card.exp_year ?? null,
    };
  } catch {
    return null;
  }
}

// Extract the Stripe product id from an invoice line item. The field location moved
// across API versions, so probe the known spots.
function productIdFromLine(line: any): string | null {
  if (!line) return null;
  const candidates = [
    line.price?.product,
    line.pricing?.price_details?.product,
    line.plan?.product,
  ];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  return null;
}

// Build a productId -> productName map for the products referenced by a set of invoices.
// Products are few, so retrieving each unique one is cheap and avoids expand-depth limits.
async function resolveProductNames(invoices: any[]): Promise<Map<string, string>> {
  const productIds = new Set<string>();
  for (const inv of invoices) {
    const pid = productIdFromLine(inv.lines?.data?.[0]);
    if (pid) productIds.add(pid);
  }

  const names = new Map<string, string>();
  await Promise.all(
    [...productIds].map(async (pid) => {
      try {
        const product = await stripe.products.retrieve(pid);
        if (product && !(product as any).deleted && (product as any).name) {
          names.set(pid, (product as any).name);
        }
      } catch {
        // ignore individual product lookup failures
      }
    }),
  );
  return names;
}

// Resolve the plan/product label for a single invoice from the resolved product map,
// falling back to the line description.
function planFromInvoice(inv: any, productNames: Map<string, string>): string | null {
  const line = inv.lines?.data?.[0];
  const pid = productIdFromLine(line);
  if (pid && productNames.has(pid)) return productNames.get(pid)!;
  if (line?.description) return line.description;
  return null;
}

export const getInvoicesByUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    if (!userId) {
      errorResponse(res, "userId is required", 400);
      return;
    }

    const subscription = await prisma.userSubscription.findFirst({
      where: { userId, stripeCustomerId: { not: null } },
      include: { user: { select: { fullName: true, email: true } } },
    });

    const user =
      subscription?.user ??
      (await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, email: true },
      }));

    // Resolve every Stripe customer id tied to this user:
    //  1. the id stored on their subscription, and
    //  2. any customer Stripe knows under their email (covers invoices created/emailed
    //     before the customer id was linked back to our DB).
    const customerIds = new Set<string>();
    if (subscription?.stripeCustomerId) {
      customerIds.add(subscription.stripeCustomerId);
    }
    if (user?.email) {
      try {
        const matches = await stripe.customers.list({ email: user.email, limit: 100 });
        matches.data.forEach((c) => customerIds.add(c.id));
      } catch (e) {
        console.error("[Billing] Customer lookup by email failed:", e);
      }
    }

    console.log(
      `[Billing] getInvoicesByUser userId=${userId} email=${user?.email ?? "none"} ` +
        `matchedCustomers=${[...customerIds].join(",") || "none"}`,
    );

    if (customerIds.size === 0) {
      successResponse(res, 200, "Invoices retrieved successfully", []);
      return;
    }

    // Gather invoices across all matched customers
    const collected = await Promise.all(
      [...customerIds].map((customerId) =>
        stripe.invoices
          .list({ customer: customerId, limit: 100 })
          .then((list) => list.data)
          .catch(() => []),
      ),
    );

    const flatInvoices = collected.flat().sort((a, b) => b.created - a.created);
    const productNames = await resolveProductNames(flatInvoices);

    const invoices = flatInvoices
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        customerId: typeof inv.customer === "string" ? inv.customer : "",
        customerName: user?.fullName ?? inv.customer_name ?? null,
        customerEmail: user?.email ?? inv.customer_email ?? null,
        plan: planFromInvoice(inv, productNames) ?? (subscription ? String(subscription.plan) : "—"),
        amount_paid: inv.amount_paid,
        amount_due: inv.amount_due,
        currency: inv.currency,
        status: inv.status,
        createdAt: new Date(inv.created * 1000).toISOString(),
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
    console.error("[Billing] Get Invoices By User Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Format a Stripe address into display lines, e.g.
//   ["San Francisco, California 94103", "United States"]
function formatAddressLines(address: any): string[] {
  if (!address) return [];
  const lines: string[] = [];
  if (address.line1) lines.push(address.line1);
  if (address.line2) lines.push(address.line2);

  const cityLine = [
    address.city,
    [address.state, address.postal_code].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);

  if (address.country) {
    let country = address.country;
    try {
      country = new Intl.DisplayNames(["en"], { type: "region" }).of(address.country) || address.country;
    } catch {
      // keep the raw country code
    }
    lines.push(country);
  }
  return lines;
}

// Best-effort retrieval of the connected account's seller details (never throws)
async function getSellerInfo(): Promise<{
  name: string | null;
  addressLines: string[];
  phone: string | null;
}> {
  try {
    // No-arg retrieve hits GET /v1/account (the account tied to the API key)
    const account: any = await (stripe.accounts as any).retrieve();
    const name =
      account?.business_profile?.name ||
      account?.settings?.dashboard?.display_name ||
      account?.company?.name ||
      null;
    const address =
      account?.business_profile?.support_address ||
      account?.company?.address ||
      null;
    const phone =
      account?.business_profile?.support_phone ||
      account?.company?.phone ||
      null;
    return { name, addressLines: formatAddressLines(address), phone };
  } catch {
    return { name: null, addressLines: [], phone: null };
  }
}

// Lazily resolve just the payment card for a single invoice (used to fill the
// Payment column in list modals without slowing down the initial list load).
export const getInvoiceCard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { invoiceId } = req.params;
    if (!invoiceId || !invoiceId.startsWith("in_")) {
      errorResponse(res, "Valid invoiceId is required", 400);
      return;
    }

    const inv = await stripe.invoices.retrieve(invoiceId);
    const paymentMethod = await resolveInvoiceCard(inv);

    successResponse(res, 200, "Invoice card retrieved successfully", { paymentMethod });
  } catch (error: any) {
    console.error("[Billing] Get Invoice Card Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getInvoiceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { invoiceId } = req.params;

    if (!invoiceId || !invoiceId.startsWith("in_")) {
      errorResponse(res, "Valid invoiceId is required", 400);
      return;
    }

    const inv = await stripe.invoices.retrieve(invoiceId, {
      expand: ["customer", "lines.data.price.product"],
    });

    const customerObj = inv.customer && typeof inv.customer === "object" ? inv.customer : null;
    const customerNotDeleted = customerObj && !("deleted" in customerObj) ? (customerObj as any) : null;
    const stripeName = customerNotDeleted?.name ?? null;
    const stripeEmail = customerNotDeleted?.email ?? null;

    const seller = await getSellerInfo();

    // Seller name on the invoice falls back to the live account profile
    const accountName = (inv as any).account_name || seller.name || null;

    // Customer billing block: prefer the invoice's snapshot, then the customer object
    const customerAddressLines = formatAddressLines(
      (inv as any).customer_address || customerNotDeleted?.address,
    );
    const customerPhone = (inv as any).customer_phone || customerNotDeleted?.phone || null;

    const fmtDate = (epoch?: number | null) =>
      epoch
        ? new Date(epoch * 1000).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : null;

    const paymentMethod = await resolveInvoiceCard(inv);

    const lineItems = inv.lines.data.map((line) => {
      const qty = line.quantity ?? 1;
      const priceUnit = (line as any).price?.unit_amount;
      const unitAmount =
        typeof priceUnit === "number" ? priceUnit : qty ? Math.round(line.amount / qty) : line.amount;
      return {
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitAmount,
        amount: line.amount,
        periodStart: fmtDate(line.period?.start),
        periodEnd: fmtDate(line.period?.end),
      };
    });

    const detail = {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      accountName,
      sellerAddressLines: seller.addressLines,
      sellerPhone: seller.phone,
      customerName: stripeName ?? inv.customer_name ?? null,
      customerEmail: stripeEmail ?? inv.customer_email ?? null,
      customerAddressLines,
      customerPhone,
      description: inv.description,
      created: fmtDate(inv.created),
      dueDate: fmtDate(inv.due_date),
      periodStart: fmtDate(inv.period_start),
      periodEnd: fmtDate(inv.period_end),
      subtotal: inv.subtotal,
      tax: Array.isArray((inv as any).total_taxes)
        ? (inv as any).total_taxes.reduce((sum: number, t: any) => sum + (t.amount ?? 0), 0)
        : 0,
      total: inv.total,
      amountPaid: inv.amount_paid,
      amountDue: inv.amount_due,
      paymentMethod,
      lineItems,
      hosted_invoice_url: inv.hosted_invoice_url,
      invoice_pdf: inv.invoice_pdf,
    };

    successResponse(res, 200, "Invoice retrieved successfully", detail);
  } catch (error: any) {
    console.error("[Billing] Get Invoice By Id Error:", error);
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
