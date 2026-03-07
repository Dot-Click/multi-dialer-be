// import axios from "axios";
// import {envConfig} from "@/lib/config";
// import prisma from "@/lib/prisma";

// const ZOHO_CLIENT_ID = envConfig.ZOHOO_CLIENT_ID as string;
// const ZOHO_CLIENT_SECRET = envConfig.ZOHOO_CLIENT_SECRET as string;
// const REDIRECT_URI = `${envConfig.BACKEND_URL}/api/subscriptions/callback`;

// // The admin's Org ID from ENV is the single source of truth
// const ZOHO_ORG_ID = envConfig.ZOHOO_ORG_ID as string;

// // In-memory cache for the admin's access token
// let cachedAdminToken: { accessToken: string; expiresAt: number } | null = null;

// /**
//  * Exchanges an authorization code for access and refresh tokens.
//  * This should be called once the user grants permission and is redirected back with a code.
//  */
// export async function exchangeCodeForTokens(code: string) {
//   try {
//     const params = new URLSearchParams(); 
//     params.append("code", code);
//     params.append("client_id", ZOHO_CLIENT_ID);
//     params.append("client_secret", ZOHO_CLIENT_SECRET);
//     params.append("redirect_uri", REDIRECT_URI);
//     params.append("grant_type", "authorization_code");

//     const response = await axios.post(
//       "https://accounts.zoho.com/oauth/v2/token",
//       params.toString(),
//       {
//         headers: {
//           "Content-Type": "application/x-www-form-urlencoded",
//         },
//       }
//     );

//     const data = response.data as any;
//     if (data.access_token) {
//       const accessToken = data.access_token;

//       // Fetch the organization ID from Zoho - CRITICAL for all API calls
//       try {
//         const orgRes = await axios.get("https://www.zohoapis.com/billing/v1/organizations", {
//           headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
//         });
//         const orgs = (orgRes.data as any).organizations || [];
//         console.log("Zoho organizations found:", orgs.length, orgs.map((o: any) => ({ id: o.organization_id, name: o.name })));
//         const organizationId = orgs[0]?.organization_id;
//         if (organizationId) {
//           data.organization_id = organizationId;
//         } else {
//           console.error("WARNING: No organization ID found in Zoho response!", orgRes.data);
//         }
//       } catch (orgError: any) {
//         console.error("CRITICAL: Could not fetch Zoho organization ID:", orgError.response?.data || orgError.message);
//       }

//       console.log("Token exchange complete. Org ID:", data.organization_id || "MISSING");
//       return data;
//     } else {
//       throw new Error("Failed to exchange code for tokens: " + JSON.stringify(data));
//     }
//   } catch (error: any) {
//     console.error("Error exchanging code for Zoho tokens:", error.response?.data || error.message);
//     throw error.response?.data || error;
//   }
// }

// /**
//  * Gets a valid Zoho access token using the admin's ENV refresh token.
//  * This always uses the admin's credentials so all operations happen under the admin's org.
//  */
// export async function getZohoAccessToken() {
//   // Use in-memory cache if still valid
//   if (cachedAdminToken && Date.now() < cachedAdminToken.expiresAt) {
//     return cachedAdminToken.accessToken;
//   }

//   // Refresh using the admin's ENV refresh token
//   return await refreshAdminToken();
// }

// /**
//  * Refreshes the Zoho access token using the admin's ENV refresh token.
//  * This is the ONLY way to get a valid access token for API operations.
//  */
// async function refreshAdminToken() {
//   const ZOHO_REFRESH_TOKEN = envConfig.ZOHOO_REFRESH_TOKEN;

//   if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
//     throw new Error("Zoho ENV credentials (ZOHOO_ID, ZOHOO_SECRET, or ZOHOO_REFRESH_TOKEN) are missing.");
//   }

//   console.log("Refreshing Zoho admin access token using ENV refresh token...");

//   try {
//     const params = new URLSearchParams();
//     params.append("refresh_token", ZOHO_REFRESH_TOKEN as string);
//     params.append("client_id", ZOHO_CLIENT_ID);
//     params.append("client_secret", ZOHO_CLIENT_SECRET);
//     params.append("grant_type", "refresh_token");

//     const response = await axios.post(
//       "https://accounts.zoho.com/oauth/v2/token",
//       params.toString(),
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     const data = response.data as any;

//     if (data.access_token) {
//       cachedAdminToken = {
//         accessToken: data.access_token,
//         expiresAt: Date.now() + data.expires_in * 1000 - 60000,
//       };
//       console.log("Zoho admin access token refreshed successfully. Using Org ID:", ZOHO_ORG_ID);
//       return cachedAdminToken.accessToken;
//     } else {
//       throw new Error("Failed to refresh Zoho access token: " + JSON.stringify(data));
//     }
//   } catch (error: any) {
//     console.error("Error refreshing Zoho admin token:", error.response?.data || error.message);
//     throw error.response?.data || error;
//   }
// }

// /**
//  * Creates a subscription in Zoho Subscriptions.
//  */
// export async function createZohoSubscription(data: any) {
//   const accessToken = await getZohoAccessToken();

//   try {
//     const response = await axios.post(
//       "https://www.zohoapis.com/billing/v1/subscriptions",
//       data,
//       {
//         headers: {
//           Authorization: `Zoho-oauthtoken ${accessToken}`,
//           "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
//           "Content-Type": "application/json",
//         },
//       }
//     );
//     return response.data;
//   } catch (error: any) {
//     console.error("Error creating Zoho subscription:", error.response?.data || error.message);
//     throw error.response?.data || error;
//   }
// }

// /**
//  * Fetches plans from Zoho Subscriptions.
//  */
// export async function getZohoPlans() {
//   const accessToken = await getZohoAccessToken();

//   try {
//     const response = await axios.get(
//       "https://www.zohoapis.com/billing/v1/plans",
//       {
//         headers: {
//           Authorization: `Zoho-oauthtoken ${accessToken}`,
//           "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
//         },
//       }
//     );
//     return response.data;
//   } catch (error: any) {
//     console.error("Error fetching Zoho plans:", error.response?.data || error.message);
//     if (error.response?.status === 401) {
//       cachedAdminToken = null; // Force refresh on next call
//     }
//     throw error.response?.data || error;
//   }
// }

// /**
//  * Creates or retrieves a customer in Zoho Subscriptions.
//  */
// export async function createZohoCustomer(data: any) {
//   const accessToken = await getZohoAccessToken();
//   console.log(`createZohoCustomer using Org ID: ${ZOHO_ORG_ID}`);

//   try {
//     // 1. Search for customer by email first to avoid "already exists" error
//     const searchRes = await axios.get(
//       `https://www.zohoapis.com/billing/v1/customers?email=${encodeURIComponent(data.email)}`,
//       {
//         headers: {
//           Authorization: `Zoho-oauthtoken ${accessToken}`,
//           "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
//         },
//       }
//     );

//     const existingCustomers = (searchRes.data as any).customers || [];
//     if (existingCustomers.length > 0) {
//       console.log("Found existing Zoho customer:", existingCustomers[0].customer_id);
//       return { customer: existingCustomers[0], message: "Existing customer found" };
//     }

//     // 2. If not found, create new
//     console.log("No existing customer found, creating new one...");
//     const response = await axios.post(
//       "https://www.zohoapis.com/billing/v1/customers",
//       data,
//       {
//         headers: {
//           Authorization: `Zoho-oauthtoken ${accessToken}`,
//           "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
//           "Content-Type": "application/json",
//         },
//       }
//     );
//     return response.data;
//   } catch (error: any) {
//     console.error("Error in createZohoCustomer flow:", error.response?.data || error.message);
//     throw error.response?.data || error;
//   }
// }

// /**
//  * Generates a Zoho Hosted Page URL for adding a payment method (card).
//  */
// export async function createZohoUpdateCardPage(customer_id: string) {
//   const accessToken = await getZohoAccessToken();

//   try {
//     const response = await axios.post(
//       "https://www.zohoapis.com/billing/v1/hostedpages/addpaymentmethod",
//       {
//         customer_id: customer_id,
//         redirect_url: `${envConfig.FRONTEND_URL}/admin/upgrade`
//       },
//       {
//         headers: {
//           Authorization: `Zoho-oauthtoken ${accessToken}`,
//           "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
//           "Content-Type": "application/json",
//         },
//       }
//     );
//     return response.data;
//   } catch (error: any) {
//     console.error("Error creating Zoho add payment method page:", error.response?.data || error.message);
//     throw error.response?.data || error;
//   }
// }


import axios from "axios";
import { envConfig } from "@/lib/config";
import prisma from "@/lib/prisma";

const ZOHO_CLIENT_ID = envConfig.ZOHOO_CLIENT_ID as string;
const ZOHO_CLIENT_SECRET = envConfig.ZOHOO_CLIENT_SECRET as string;
const REDIRECT_URI = `${envConfig.BACKEND_URL}/api/subscriptions/callback`;

const ZOHO_API = "https://www.zohoapis.com/billing/v1";

/**
 * Exchange OAuth Code for Tokens
 */
export async function exchangeCodeForTokens(code: string) {
  const params = new URLSearchParams();

  params.append("code", code);
  params.append("client_id", ZOHO_CLIENT_ID);
  params.append("client_secret", ZOHO_CLIENT_SECRET);
  params.append("redirect_uri", REDIRECT_URI);
  params.append("grant_type", "authorization_code");

  const res = await axios.post(
    "https://accounts.zoho.com/oauth/v2/token",
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const data: any = res.data;

  if (!data.access_token) {
    throw new Error(`Zoho OAuth failed: ${JSON.stringify(data)}`);
  }

  /** fetch org id */
  try {
    // Try both Billing and Subscriptions endpoints if one fails or returns nothing
    const endpoints = [
      "https://www.zohoapis.com/billing/v1/organizations",
      "https://subscriptions.zoho.com/api/v1/organizations"
    ];
    
    let organizationId = null;
    
    for (const endpoint of endpoints) {
      try {
        const orgRes = await axios.get(endpoint, {
          headers: { Authorization: `Zoho-oauthtoken ${data.access_token}` },
        });
        const orgs = (orgRes.data as any)?.organizations || [];
        if (orgs.length > 0) {
          organizationId = orgs[0].organization_id;
          console.log(`[Zoho OAuth] Found org: ${organizationId} via ${endpoint}`);
          break;
        }
      } catch (e) {
        console.warn(`[Zoho OAuth] Failed to fetch orgs from ${endpoint}`);
      }
    }
    
    data.organization_id = organizationId;
  } catch (orgErr: any) {
    console.error('[Zoho OAuth] Critical error fetching org ID:', orgErr.message);
  }

  console.log(`[Zoho OAuth] Token exchange complete. refresh_token present: ${!!data.refresh_token}, org_id: ${data.organization_id || 'MISSING'}`);
  return data;
}

/**
 * Get Master Zoho Integration
 * The "Master" integration is the one created by the Admin during setup.
 * All customer billing operations flow through this single organization.
 */
export async function getMasterZohoIntegration() {
  const integration = await (prisma as any).integration.findFirst({
    where: { 
      provider: "ZOHO", 
      status: "CONNECTED",
    },
    orderBy: {
      updatedAt: 'desc' // Get the most recently updated one
    },
    include: {
      systemSetting: {
        include: {
          user: true
        }
      }
    }
  });

  if (!integration) {
    console.error("[Zoho] Master integration not found. Admin needs to link Zoho.");
    throw new Error("Zoho not connected. Admin must link Zoho via /api/subscriptions/auth first.");
  }

  const ownerEmail = (integration.systemSetting as any)?.user?.email;
  console.log(`[Zoho Master] Using integration ID: ${integration.id} (Owner: ${ownerEmail || 'Unknown'})`);

  return integration;
}

/**
 * Get Valid Access Token
 * Always uses the Master integration's credentials.
 */
export async function getZohoAccessToken() {
  const integration = await getMasterZohoIntegration();
  const creds = integration.credentials as any;

  if (creds?.access_token && Date.now() < creds.expires_at) {
    return creds.access_token;
  }

  return refreshZohoToken(integration.id);
}

/**
 * Refresh Token
 */
export async function refreshZohoToken(integrationId: string) {
  const integration = await (prisma as any).integration.findUnique({
    where: { id: integrationId },
  });

  const creds = integration?.credentials as any;
  const refresh_token = creds?.refresh_token;

  console.log(`[Zoho Refresh] integrationId: ${integrationId}, refresh_token present: ${!!refresh_token}`);
  console.log(`[Zoho Refresh] creds: ${JSON.stringify(creds)}`);
  if (!refresh_token) {
    throw new Error("Zoho token refresh failed: no refresh_token stored. Please re-authorize via /api/subscriptions/auth");
  }

  const params = new URLSearchParams();
  params.append("refresh_token", refresh_token);
  params.append("client_id", ZOHO_CLIENT_ID);
  params.append("client_secret", ZOHO_CLIENT_SECRET);
  params.append("grant_type", "refresh_token");

  const res = await axios.post(
    "https://accounts.zoho.com/oauth/v2/token",
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const data: any = res.data;
  console.log(`[Zoho Refresh] Zoho response:`, JSON.stringify(data));

  if (!data.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(data)}`);
  }

  const expires_at = Date.now() + data.expires_in * 1000 - 60000;

  // If Zoho returned a NEW refresh token, store it. Otherwise keep the old one.
  const updatedCredentials = {
    ...(integration?.credentials as object),
    access_token: data.access_token,
    expires_at,
  };

  if (data.refresh_token) {
    (updatedCredentials as any).refresh_token = data.refresh_token;
  }

  await (prisma as any).integration.update({
    where: { id: integrationId },
    data: {
      credentials: updatedCredentials,
    },
  });

  return data.access_token;
}

/**
 * Base Zoho Request Wrapper
 */
async function zohoRequest(method: string, url: string, data?: any) {
  const integration = await getMasterZohoIntegration();
  const accessToken = await getZohoAccessToken();
  const creds = integration.credentials as any;

  const orgId = creds?.organization_id || envConfig.ZOHOO_ORG_ID;

  if (!orgId) {
    throw new Error("Zoho Organization ID missing. Ensure Admin has completed Zoho setup.");
  }

  const headers: any = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    "X-com-zoho-subscriptions-organizationid": orgId,
    "Content-Type": "application/json",
  };

  console.log(`[Zoho Request] ${method} ${url} | orgId: ${orgId} | token: ${accessToken ? accessToken.slice(0, 10) + '…' : 'MISSING'}`);

  try {
    const res = await axios({
      method,
      url: `${ZOHO_API}${url}`,
      data,
      headers
    });

    return res.data;
  } catch (err: any) {
    /** retry once if token expired */
    if (err.response?.status === 401) {
      console.log("[Zoho Request] 401 Unauthorized. Attempting token refresh...");
      const newAccessToken = await refreshZohoToken(integration.id);
      
      const retry = await axios({
        method,
        url: `${ZOHO_API}${url}`,
        data,
        headers: {
          ...headers,
          Authorization: `Zoho-oauthtoken ${newAccessToken}`,
        },
      });

      return retry.data;
    }

    console.error("Zoho API Error:", JSON.stringify(err.response?.data || err.message));
    throw err.response?.data || err;
  }
}

/**
 * Get Plans
 */
export async function getZohoPlans() {
  return zohoRequest("GET", "/plans");
}

/**
 * Create Subscription
 */
export async function createZohoSubscription(payload: any) {
  return zohoRequest("POST", "/subscriptions", payload);
}

/**
 * Create or Get Customer
 */
export async function createZohoCustomer(data: any) {
  const search = await zohoRequest(
    "GET",
    `/customers?email=${encodeURIComponent(data.email)}`
  );

  if (search?.customers?.length) {
    return { customer: search.customers[0] };
  }

  return zohoRequest("POST", "/customers", data);
}

/**
 * Hosted Page: Add Payment Method
 */
export async function createZohoUpdateCardPage(customer_id: string) {
  return zohoRequest("POST", "/hostedpages/addpaymentmethod", {
    customer_id,
    redirect_url: `${envConfig.FRONTEND_URL}/admin/upgrade`,
  });
}
