import { Request, Response } from "express";
import { createZohoSubscription, getZohoPlans, exchangeCodeForTokens, createZohoCustomer } from "./services";
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


export async function createSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { plan_code } = req.body;

    if (!plan_code) {
      errorResponse(res, "plan_code is required", 400);
      return;
    }

    // Use req.user if available (from protectRoute), otherwise use placeholders
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

    const subscriptionPayload = {
      customer_id: customer_id,
      auto_collect: true,
      plan: {
        plan_code: plan_code
      }
    };

    console.log("Creating Zoho subscription for customer:", customer_id);
    const result = await createZohoSubscription(subscriptionPayload);
    successResponse(res, 201, "Customer and Subscription created successfully", result);
  } catch (error: any) {
    console.error("Controller Error (createSubscription):", error);
    errorResponse(res, error, error.code === 400 ? 400 : 500);
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