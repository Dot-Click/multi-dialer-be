import { Request, Response } from "express";
import { createZohoSubscription, getZohoPlans, exchangeCodeForTokens, createZohoCustomer, createZohoUpdateCardPage } from "./services";
import { successResponse, errorResponse } from "@/utils/handler";
import { envConfig } from "@/lib/config";
import prisma from "@/lib/prisma";

export async function zohoAuth(req: Request, res: Response): Promise<void> {
  // Use user id as state to link the callback
  const state = req.user?.id || "system";
  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=${envConfig.ZOHOO_CLIENT_ID}&scope=ZohoSubscriptions.fullaccess.all&redirect_uri=${envConfig.BACKEND_URL}/api/subscriptions/callback&access_type=offline&prompt=consent&state=${state}`;
  console.log("Redirecting to Zoho Auth for user:", state);
  res.redirect(authUrl);
}



export async function zohoAuthCallback(req: Request, res: Response): Promise<void> {
  try {
    const { code, state } = req.query as { code: string; state: string };
    if (!code) {
      errorResponse(res, "Authorization code is required", 400);
      return;
    }

    const tokens = await exchangeCodeForTokens(code);
    
    // Persist tokens to Database for "Fully Server-Side" operation
    // 1. Find or create system settings for the user (or system)
    const userId = state && state !== "system" ? state : (req.user?.id || (await (prisma as any).user.findFirst({ where: { role: 'ADMIN' } }))?.id);
    
    if (userId && tokens.refresh_token) {
      let systemSetting = await (prisma as any).system_Setting.findFirst({
        where: { userId }
      });

      if (!systemSetting) {
        systemSetting = await (prisma as any).system_Setting.create({
          data: { userId }
        });
      }

      await (prisma as any).integration.upsert({
        where: {
          systemSettingId_provider: {
            systemSettingId: systemSetting.id,
            provider: 'ZOHO'
          }
        },
        update: {
          credentials: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000)
          },
          status: 'CONNECTED'
        },
        create: {
          systemSettingId: systemSetting.id,
          provider: 'ZOHO',
          credentials: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000)
          },
          status: 'CONNECTED'
        }
      });
      console.log(`Zoho Integration persisted for user ${userId}`);
    }
    // res.send("<p style='color: green;'>Zoho Integration successful</p>");
    res.redirect(`${envConfig.FRONTEND_URL}/admin/upgrade`);
    return;
  } catch (error: any) {
    console.error("Controller Error (zohoAuthCallback):", error);
    errorResponse(res, error);
  }
}

/**
 * Generates a Zoho Hosted Page URL for updating a card.
 */
export async function getUpdateCardUrl(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;

    if (!userId) {
      errorResponse(res, "Unauthorized", 401);
      return;
    }

    // 1. Create/Get Zoho Customer (if not already exists)
    const customerData = {
      display_name: req.user?.fullName || `Customer_${Date.now()}`,
      email: req.user?.email || `customer_${Date.now()}@example.com`,
    };

    console.log("Creating/Getting Zoho customer for card update page:", customerData);
    const customerRes: any = await createZohoCustomer(customerData);
    const customer_id = customerRes?.customer?.customer_id;

    if (!customer_id) {
      throw new Error("Failed to get customer_id from Zoho response");
    }

    // 2. Generate Hosted Page URL
    console.log("Generating Zoho update card page for customer:", customer_id);
    const result = await createZohoUpdateCardPage(customer_id);

    successResponse(res, 201, "Update card URL generated successfully", result);
  } catch (error: any) {
    console.error("Controller Error (getUpdateCardUrl):", error);
    errorResponse(res, error.message || error, 500);
  }
}


export async function createSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { plan_code } = req.body;
    const userId = req.user?.id;

    if (!plan_code) {
      errorResponse(res, "plan_code is required", 400);
      return;
    }

    if (!userId) {
      errorResponse(res, "Unauthorized: User ID not found", 401);
      return;
    }

    // Map Zoho plan_code to local Plan enum
    const planMapping: Record<string, "STARTER" | "PROFESSIONAL" | "ENTERPRISE"> = {
      starter_123: "STARTER",
      professional_123: "PROFESSIONAL",
      enterprise_123: "ENTERPRISE",
    };

    const mappedPlan = planMapping[plan_code];
    if (!mappedPlan) {
      errorResponse(res, `Invalid plan_code: ${plan_code}`, 400);
      return;
    }

    // 1. Create/Get Zoho Customer
    const customerData = {
      display_name: req.user?.fullName || `Customer_${Date.now()}`,
      email: req.user?.email || `customer_${Date.now()}@example.com`,
    };

    console.log("Creating new Zoho customer:", customerData);
    const customerRes: any = await createZohoCustomer(customerData);
    const customer_id = customerRes?.customer?.customer_id;

    if (!customer_id) {
      throw new Error("Failed to get customer_id from Zoho response");
    }

    // 2. Create Zoho Subscription
    const subscriptionPayload = {
      customer_id: customer_id,
      auto_collect: true,
      plan: {
        plan_code: plan_code,
      },
    };

    console.log("Creating Zoho subscription for customer:", customer_id);
    const result = await createZohoSubscription(subscriptionPayload) as any;
    const zohoSub = result?.subscription;

    if (!zohoSub) {
      throw new Error("Failed to get subscription details from Zoho response");
    }

    // 3. Store in local database
    // Map Zoho interval_unit to local BillingCycle enum
    const billingCycleMapping: Record<string, "MONTHLY" | "YEARLY"> = {
      months: "MONTHLY",
      years: "YEARLY",
    };

    const billingCycle = billingCycleMapping[zohoSub.interval_unit] || "MONTHLY";

    // Upsert the subscription (one plan type per user as per schema@@unique([userId, plan]))
    const userSubscription = await prisma.userSubscription.upsert({
      where: {
        userId_plan: {
          userId: userId,
          plan: mappedPlan,
        },
      },
      update: {
        status: "ACTIVE", // Or map from zohoSub.status if needed
        startDate: new Date(zohoSub.activated_at || zohoSub.current_term_starts_at),
        endDate: zohoSub.expires_at ? new Date(zohoSub.expires_at) : (zohoSub.next_billing_at ? new Date(zohoSub.next_billing_at) : null),
        billingCycle: billingCycle,
        updatedAt: new Date(),
      },
      create: {
        userId: userId,
        plan: mappedPlan,
        status: "ACTIVE",
        startDate: new Date(zohoSub.activated_at || zohoSub.current_term_starts_at),
        endDate: zohoSub.expires_at ? new Date(zohoSub.expires_at) : (zohoSub.next_billing_at ? new Date(zohoSub.next_billing_at) : null),
        billingCycle: billingCycle,
        usersCount: 1, // Defaulting to 1
      },
    });

    successResponse(res, 201, "Subscription created and saved successfully", {
      zoho: result,
      local: userSubscription,
    });
  } catch (error: any) {
    console.error("Controller Error (createSubscription):", error);
    errorResponse(res, error.message || error, 500);
  }
}


export async function listPlans(req: Request, res: Response): Promise<void> {
  try {
    const plans = await getZohoPlans();
    successResponse(res, 200, "Plans fetched successfully", plans);
  } catch (error: any) {
    console.error("Controller Error (listPlans):", error);
    errorResponse(res, error);
  }
}