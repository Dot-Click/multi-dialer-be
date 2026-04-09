// import { Request, Response } from "express";
// import { createZohoSubscription, getZohoPlans, exchangeCodeForTokens, createZohoCustomer, createZohoUpdateCardPage } from "./services";
// import { successResponse, errorResponse } from "@/utils/handler";
// import { envConfig } from "@/lib/config";
// import prisma from "@/lib/prisma";

// export async function zohoAuth(req: Request, res: Response): Promise<void> {
//   // Use user id as state to link the callback
//   const state = req.user?.id || "system";
//   const authUrl = `https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=${envConfig.ZOHOO_CLIENT_ID}&scope=ZohoSubscriptions.fullaccess.all&redirect_uri=${envConfig.BACKEND_URL}/api/subscriptions/callback&access_type=offline&prompt=consent&state=${state}`;
//   console.log("Redirecting to Zoho Auth for user:", state);
//   res.redirect(authUrl);
// }



// export async function zohoAuthCallback(req: Request, res: Response): Promise<void> {
//   try {
//     const { code, state } = req.query as { code: string; state: string };
//     if (!code) {
//       errorResponse(res, "Authorization code is required", 400);
//       return;
//     }

//     const tokens = await exchangeCodeForTokens(code);
    
//     // Persist tokens to Database for "Fully Server-Side" operation
//     // 1. Find or create system settings for the user (or system)
//     const userId = state && state !== "system" ? state : (req.user?.id || (await (prisma as any).user.findFirst({ where: { role: 'ADMIN' } }))?.id);
    
//     if (userId && tokens.refresh_token) {
//       let systemSetting = await (prisma as any).system_Setting.findFirst({
//         where: { userId }
//       });

//       if (!systemSetting) {
//         systemSetting = await (prisma as any).system_Setting.create({
//           data: { userId }
//         });
//       }

//       await (prisma as any).integration.upsert({
//         where: {
//           systemSettingId_provider: {
//             systemSettingId: systemSetting.id,
//             provider: 'ZOHO'
//           }
//         },
//         update: {
//           credentials: {
//             access_token: tokens.access_token,
//             refresh_token: tokens.refresh_token,
//             expires_at: Date.now() + (tokens.expires_in * 1000),
//             organization_id: tokens.organization_id // Store dynamic Org ID
//           },
//           status: 'CONNECTED'
//         },
//         create: {
//           systemSettingId: systemSetting.id,
//           provider: 'ZOHO',
//           credentials: {
//             access_token: tokens.access_token,
//             refresh_token: tokens.refresh_token,
//             expires_at: Date.now() + (tokens.expires_in * 1000),
//             organization_id: tokens.organization_id
//           },
//           status: 'CONNECTED'
//         }
//       });
//       console.log(`Zoho Integration persisted for user ${userId} | Org ID: ${tokens.organization_id || 'MISSING'}`);
//     }
//     // res.send("<p style='color: green;'>Zoho Integration successful</p>");
//     res.redirect(`${envConfig.FRONTEND_URL}/admin/upgrade`);
//     return;
//   } catch (error: any) {
//     console.error("Controller Error (zohoAuthCallback):", error);
//     errorResponse(res, error);
//   }
// }

// /**
//  * Generates a Zoho Hosted Page URL for updating a card.
//  */
// export async function getUpdateCardUrl(req: Request, res: Response): Promise<void> {
//   try {
//     const userId = req.user?.id;

//     if (!userId) {
//       errorResponse(res, "Unauthorized", 401);
//       return;
//     }

//     // 1. Create/Get Zoho Customer (if not already exists)
//     const customerData = {
//       display_name: req.user?.fullName || `Customer_${Date.now()}`,
//       email: req.user?.email || `customer_${Date.now()}@example.com`,
//     };

//     console.log("Creating/Getting Zoho customer for card update page:", customerData);
//     const customerRes: any = await createZohoCustomer(customerData);
//     const customer_id = customerRes?.customer?.customer_id;

//     if (!customer_id) {
//       throw new Error("Failed to get customer_id from Zoho response");
//     }

//     // 2. Generate Hosted Page URL
//     console.log("Generating Zoho update card page for customer:", customer_id);
//     const result = await createZohoUpdateCardPage(customer_id);

//     successResponse(res, 201, "Update card URL generated successfully", result);
//   } catch (error: any) {
//     console.error("Controller Error (getUpdateCardUrl):", error);
//     errorResponse(res, error.message || error, 500);
//   }
// }


// export async function createSubscription(req: Request, res: Response): Promise<void> {
//   try {
//     const { plan_code } = req.body;
//     const userId = req.user?.id;

//     if (!plan_code) {
//       errorResponse(res, "plan_code is required", 400);
//       return;
//     }

//     if (!userId) {
//       errorResponse(res, "Unauthorized: User ID not found", 401);
//       return;
//     }

//     // Map Zoho plan_code to local Plan enum
//     const planMapping: Record<string, "STARTER" | "PROFESSIONAL" | "ENTERPRISE"> = {
//       starter_123: "STARTER",
//       professional_123: "PROFESSIONAL",
//       enterprise_123: "ENTERPRISE",
//     };

//     const mappedPlan = planMapping[plan_code];
//     if (!mappedPlan) {
//       errorResponse(res, `Invalid plan_code: ${plan_code}`, 400);
//       return;
//     }

//     // 1. Create/Get Zoho Customer
//     const customerData = {
//       display_name: req.user?.fullName || `Customer_${Date.now()}`,
//       email: req.user?.email || `customer_${Date.now()}@example.com`,
//     };

//     console.log("Creating/Getting Zoho customer:", customerData);
//     const customerRes: any = await createZohoCustomer(customerData);
//     const customer_id = customerRes?.customer?.customer_id;

//     if (!customer_id) {
//       throw new Error("Failed to get customer_id from Zoho response");
//     }

//     // 2. Create Zoho Subscription
//     const subscriptionPayload = {
//       customer_id: customer_id,
//       auto_collect: true,
//       plan: {
//         plan_code: plan_code,
//       },
//     };

//     console.log("Creating Zoho subscription for customer:", customer_id);
//     const result = await createZohoSubscription(subscriptionPayload) as any;
//     const zohoSub = result?.subscription;

//     if (!zohoSub) {
//       throw new Error("Failed to get subscription details from Zoho response");
//     }

//     // 3. Store in local database
//     // Map Zoho interval_unit to local BillingCycle enum
//     const billingCycleMapping: Record<string, "MONTHLY" | "YEARLY"> = {
//       months: "MONTHLY",
//       years: "YEARLY",
//     };

//     const billingCycle = billingCycleMapping[zohoSub.interval_unit] || "MONTHLY";

//     // Upsert the subscription (matching the schema constraint: @@unique([userId, plan]))
//     const userSubscription = await prisma.userSubscription.upsert({
//       where: {
//         userId_plan: {
//           userId: userId,
//           plan: mappedPlan,
//         },
//       },
//       update: {
//         zohooCustomerId: customer_id,
//         status: "ACTIVE", // Or map from zohoSub.status if needed
//         startDate: new Date(zohoSub.activated_at || zohoSub.current_term_starts_at),
//         endDate: zohoSub.expires_at ? new Date(zohoSub.expires_at) : (zohoSub.next_billing_at ? new Date(zohoSub.next_billing_at) : null),
//         billingCycle: billingCycle,
//         updatedAt: new Date(),
//       },
//       create: {
//         userId: userId,
//         plan: mappedPlan,
//         zohooCustomerId: customer_id,
//         status: "ACTIVE",
//         startDate: new Date(zohoSub.activated_at || zohoSub.current_term_starts_at),
//         endDate: zohoSub.expires_at ? new Date(zohoSub.expires_at) : (zohoSub.next_billing_at ? new Date(zohoSub.next_billing_at) : null),
//         billingCycle: billingCycle,
//         usersCount: 1, // Defaulting to 1
//       },
//     });

//     successResponse(res, 201, "Subscription created and saved successfully", {
//       zoho: result,
//       local: userSubscription,
//     });
//   } catch (error: any) {
//     console.error("Controller Error (createSubscription):", error);
//     errorResponse(res, error.message || error, 500);
//   }
// }


// export async function listPlans(req: Request, res: Response): Promise<void> {
//   try {
//     const plans = await getZohoPlans();
//     successResponse(res, 200, "Plans fetched successfully", plans);
//   } catch (error: any) {
//     console.error("Controller Error (listPlans):", error);
//     errorResponse(res, error);
//   }
// }


// export async function listSubscriptions(req: Request, res: Response): Promise<void> {
//   try {
//     const subscriptions = await prisma.userSubscription.findMany({
//       where: {
//         userId: req.user?.id,
//       },
//     });
//     successResponse(res, 200, "Subscriptions fetched successfully", subscriptions);
//   } catch (error: any) {
//     console.error("Controller Error (listSubscriptions):", error);
//     errorResponse(res, error);
//   }
// }

// export async function listBillings(req: Request, res: Response): Promise<void> {
//   try {
//     const subscriptions = await prisma.billing.findMany({
//       where: {
//         userId: req.user?.id,
//       },
//     });
//     successResponse(res, 200, "Subscriptions fetched successfully", subscriptions);
//   } catch (error: any) {
//     console.error("Controller Error (listSubscriptions):", error);
//     errorResponse(res, error);
//   }
// }

import { Request, Response } from "express";
import {
  createZohoSubscription,
  getZohoPlans,
  exchangeCodeForTokens,
  createZohoCustomer,
  createZohoUpdateCardPage,
} from "./services";
import { successResponse, errorResponse } from "@/utils/handler";
import { envConfig } from "@/lib/config";
import prisma from "@/lib/prisma";

/**
 * Zoho OAuth
 */
export async function zohoAuth(req: Request, res: Response): Promise<void> {
  const state = req.user?.id || "system";

  console.log(`[Zoho Auth] Initiating linkage for user: ${req.user?.email || 'system'} (ID: ${state})`);

  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=${envConfig.ZOHOO_CLIENT_ID}&scope=ZohoSubscriptions.fullaccess.all&redirect_uri=${envConfig.BACKEND_URL}/api/subscriptions/callback&access_type=offline&prompt=consent&state=${state}`;

  res.redirect(authUrl);
}

/**
 * Zoho OAuth Callback
 */
export async function zohoAuthCallback(req: Request, res: Response): Promise<void> {
  try {
    const { code, state } = req.query as { code: string; state: string };

    if (!code) {
      errorResponse(res, "Authorization code missing", 400);
      return;
    }

    const tokens = await exchangeCodeForTokens(code) as any;

    // We always link the Zoho integration to either the current Admin or the first Admin found.
    // This allows the system to have a single "Master" Integration record.
    const userId =
      req.user?.role === "ADMIN" 
        ? req.user.id 
        : (state && state !== "system" ? state : (await prisma.user.findFirst({ where: { role: "ADMIN" } }))?.id);

    if (!userId) {
      console.error("[Zoho Callback] No Admin user found to link integration to.");
      errorResponse(res, "Admin user not found. Cannot link system integration.", 404);
      return;
    }

    let systemSetting = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSetting) {
      systemSetting = await prisma.system_Setting.create({
        data: { userId },
      });
    }

    // Clean up any old Zoho integrations to ensure this is the only "Master" one
    await prisma.integration.deleteMany({
      where: {
        provider: "ZOHO",
        // Only delete if it's NOT the one we are about to update
        // but since we use upsert with a unique constraint, we can just let upsert handle the same record
        // and delete OTHER records that might have been created under different systemSettingIds
        systemSetting: {
          userId: { not: userId }
        }
      }
    });

    await prisma.integration.upsert({
      where: {
        systemSettingId_provider: {
          systemSettingId: systemSetting.id,
          provider: "ZOHO",
        },
      },
      update: {
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + tokens.expires_in * 1000,
          organization_id: tokens.organization_id,
        },
        status: "CONNECTED",
      },
      create: {
        systemSettingId: systemSetting.id,
        provider: "ZOHO",
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + tokens.expires_in * 1000,
          organization_id: tokens.organization_id,
        },
        status: "CONNECTED",
      },
    });

    console.log(`[Zoho Callback] Stored for user ${userId} | refresh_token: ${!!tokens.refresh_token} | org_id: ${tokens.organization_id || 'MISSING'}`);

    res.redirect(`${envConfig.FRONTEND_URL}/admin/upgrade`);
  } catch (error: any) {
    console.error(error);
    errorResponse(res, error.message || error);
  }
}

/**
 * Get or Create Zoho Customer
 */
async function getOrCreateZohoCustomer(user: any) {
  // Try to find an existing subscription with a Zoho customer ID for this user
  const existingSub = await prisma.userSubscription.findFirst({
    where: { userId: user.id, zohooCustomerId: { not: null } },
    select: { zohooCustomerId: true },
  });

  if (existingSub?.zohooCustomerId) return existingSub.zohooCustomerId;

  const customer = await createZohoCustomer({
    display_name: user.fullName || `Customer_${Date.now()}`,
    email: user.email,
  });

  const customerId = customer?.customer?.customer_id;

  if (!customerId) throw new Error("Zoho customer creation failed");

  return customerId;
}

/**
 * Create Subscription
 */
export async function createSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { plan_code } = req.body;
    const user = req.user;

    if (!plan_code) {
      errorResponse(res, "plan_code required", 400);
      return;
    }

    if (!user?.id) {
      errorResponse(res, "Unauthorized", 401);
      return;
    }

    const planMapping: Record<string, "STARTER" | "PROFESSIONAL" | "ENTERPRISE"> =
      {
        starter_123: "STARTER",
        professional_123: "PROFESSIONAL",
        enterprise_123: "ENTERPRISE",
      };

    const mappedPlan = planMapping[plan_code];

    if (!mappedPlan) {
      errorResponse(res, "Invalid plan_code", 400);
      return;
    }

    /**
     * 1️⃣ Get/Create Zoho Customer
     */
    const customerId = await getOrCreateZohoCustomer(user);

    /**
     * 2️⃣ Create Zoho Subscription
     */
    const zohoRes: any = await createZohoSubscription({
      customer_id: customerId,
      auto_collect: true,
      plan: { plan_code },
    });

    const zohoSub = zohoRes?.subscription;

    if (!zohoSub) {
      throw new Error("Zoho subscription creation failed");
    }

    /**
     * 3️⃣ Save locally (Expire old ones first)
     */
    const billingCycle =
      zohoSub.interval_unit === "years" ? "YEARLY" : "MONTHLY";

    // Set all previous active subscriptions to EXPIRED
    await prisma.userSubscription.updateMany({
      where: { userId: user.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });

    const subscription = await prisma.userSubscription.create({
      data: {
        userId: user.id,
        plan: mappedPlan,
        amount: String(zohoSub.amount),
        status: "ACTIVE",
        zohooCustomerId: customerId,
        startDate: new Date(),
        billingCycle,
        usersCount: 1,
      },
    });

    successResponse(res, 201, "Subscription created", {
      hostedPage: zohoRes?.hostedpage?.url,
      subscription,
    });
  } catch (error: any) {
    console.error(error);
    errorResponse(res, error.message || error);
  }
}

/**
 * Update Card Page
 */
export async function getUpdateCardUrl(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;

    if (!user?.id) {
      errorResponse(res, "Unauthorized", 401);
      return;
    }

    const customerId = await getOrCreateZohoCustomer(user);

    const result = await createZohoUpdateCardPage(customerId);

    successResponse(res, 200, "Update card URL generated", result);
  } catch (error: any) {
    console.error(error);
    errorResponse(res, error.message || error);
  }
}

/**
 * List Plans
 */
export async function listPlans(req: Request, res: Response): Promise<void> {
  try {
    const data = await getZohoPlans();
    successResponse(res, 200, "Plans fetched", data.plans || []);
  } catch (error: any) {
    errorResponse(res, error);
  }
}

/**
 * List User Subscriptions
 */
export async function listSubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const subs = await prisma.userSubscription.findMany({
      where: { userId: req.user?.id },
      orderBy: { createdAt: "desc" },
    });

    successResponse(res, 200, "Subscriptions fetched", subs);
  } catch (error: any) {
    errorResponse(res, error);
  }
}

/**
 * List Billings
 */
export async function listBillings(req: Request, res: Response): Promise<void> {
  try {
    const billings = await prisma.billing.findMany({
      where: { userId: req.user?.id },
    });

    successResponse(res, 200, "Billings fetched", billings);
  } catch (error: any) {
    errorResponse(res, error);
  }
}

/**
 * List All Subscriptions (Admin/Owner only)
 */
export async function listAllSubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const subs = await prisma.userSubscription.findMany({
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
          }
        },
      },
      orderBy: { createdAt: "desc" },
    });

    successResponse(res, 200, "All subscriptions fetched successfully", subs);
  } catch (error: any) {
    console.error("[Controller] listAllSubscriptions Error:", error);
    errorResponse(res, error.message || error);
  }
}

/**
 * Fetch Plans directly from Zoho (Dedicated API)
 */
export async function fetchZohoPlans(req: Request, res: Response): Promise<void> {
  try {
    const data = await getZohoPlans();
    successResponse(res, 200, "Zoho Plans fetched successfully", data.plans || []);
  } catch (error: any) {
    console.error("[Controller] fetchZohoPlans Error:", error);
    errorResponse(res, error.message || error);
  }
}