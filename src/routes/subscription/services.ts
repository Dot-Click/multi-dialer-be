import axios from "axios";
import {envConfig} from "@/lib/config";
import prisma from "@/lib/prisma";

const ZOHO_CLIENT_ID = envConfig.ZOHOO_CLIENT_ID as string;
const ZOHO_CLIENT_SECRET = envConfig.ZOHOO_CLIENT_SECRET as string;
const REDIRECT_URI = `${envConfig.BACKEND_URL}/api/subscriptions/callback`;

let cachedToken = {
  accessToken: envConfig.ZOHOO_ACCESS_TOKEN || "",
  expiresAt: 0,
};

/**
 * Exchanges an authorization code for access and refresh tokens.
 * This should be called once the user grants permission and is redirected back with a code.
 */
export async function exchangeCodeForTokens(code: string) {
  try {
    const params = new URLSearchParams(); 
    params.append("code", code);
    params.append("client_id", ZOHO_CLIENT_ID);
    params.append("client_secret", ZOHO_CLIENT_SECRET);
    params.append("redirect_uri", REDIRECT_URI);
    params.append("grant_type", "authorization_code");

    const response = await axios.post(
      "https://accounts.zoho.com/oauth/v2/token",
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const data = response.data as any;
    console.log(data);
    if (data.access_token) {
      cachedToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000 - 60000,
      };
      return data; // Contains access_token, refresh_token, etc.
    } else {
      throw new Error("Failed to exchange code for tokens: " + JSON.stringify(data));
    }
  } catch (error: any) {
    console.error("Error exchanging code for Zoho tokens:", error.response?.data || error.message);
    throw error.response?.data || error;
  }
}

/**
 * Gets a valid Zoho access token, refreshing it if necessary.
 */
export async function getZohoAccessToken() {
  const now = Date.now();
  
  if (cachedToken.accessToken && now < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const integration = await (prisma as any).integration.findFirst({
    where: { provider: 'ZOHO', status: 'CONNECTED' },
    select: { credentials: true, id: true }
  });

  if (integration && integration.credentials) {
    const creds = integration.credentials as any;
    if (creds.access_token && Date.now() < (creds.expires_at || 0)) {
      cachedToken = {
        accessToken: creds.access_token,
        expiresAt: creds.expires_at
      };
      return cachedToken.accessToken;
    }
  }

  return await refreshZohoToken();
}

/**
 * Refreshes the Zoho access token using the refresh token.
 */
export async function refreshZohoToken() {
  const integration = await (prisma as any).integration.findFirst({
    where: { provider: 'ZOHO' }
  });

  const ZOHO_REFRESH_TOKEN = (integration?.credentials as any)?.refresh_token || envConfig.ZOHOO_REFRESH_TOKEN;

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error("Zoho credentials (ID, Secret, or Refresh Token) are missing. Please complete the /auth step once.");
  }

  try {
    const params = new URLSearchParams();
    params.append("refresh_token", ZOHO_REFRESH_TOKEN as string);
    params.append("client_id", ZOHO_CLIENT_ID);
    params.append("client_secret", ZOHO_CLIENT_SECRET);
    params.append("grant_type", "refresh_token");

    const response = await axios.post(
      "https://accounts.zoho.com/oauth/v2/token",
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const data = response.data as any;

    if (data.access_token) {
      const expiresAt = Date.now() + data.expires_in * 1000 - 60000;
      cachedToken = {
        accessToken: data.access_token,
        expiresAt: expiresAt,
      };


      if (integration) {
        await (prisma as any).integration.update({
          where: { id: integration.id },
          data: {
            credentials: {
              ...(integration.credentials as object),
              access_token: data.access_token,
              expires_at: expiresAt
            }
          }
        });
      }

      console.log("Zoho access token refreshed and persisted successfully.");
      return cachedToken.accessToken;
    } else {
      throw new Error("Failed to refresh Zoho access token: " + JSON.stringify(data));
    }
  } catch (error: any) {
    console.error("Error refreshing Zoho token:", error.response?.data || error.message);
    throw error.response?.data || error;
  }
}

/**
 * Creates a subscription in Zoho Subscriptions.
 */
export async function createZohoSubscription(data: any) {
  const accessToken = await getZohoAccessToken();
  const ZOHO_ORG_ID = envConfig.ZOHOO_ORG_ID;

  try {
    const response = await axios.post(
      "https://www.zohoapis.com/billing/v1/subscriptions",
      data,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error("Error creating Zoho subscription:", error.response?.data || error.message);
    throw error.response?.data || error;
  }
}

/**
 * Fetches plans from Zoho Subscriptions.
 */
export async function getZohoPlans() {
  const accessToken = await getZohoAccessToken();
  const ZOHO_ORG_ID = envConfig.ZOHOO_ORG_ID;

  try {
    const response = await axios.get(
      "https://www.zohoapis.com/billing/v1/plans",
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error("Error fetching Zoho plans:", error.response?.data || error.message);
    if (error.response?.status === 401) {
      cachedToken.expiresAt = 0; // Force refresh on next try
    }
    throw error.response?.data || error;
  }
}

/**
 * Creates a customer in Zoho Subscriptions.
 */
export async function createZohoCustomer(data: any) {
  const accessToken = await getZohoAccessToken();
  const ZOHO_ORG_ID = envConfig.ZOHOO_ORG_ID;

  try {
    const response = await axios.post(
      "https://www.zohoapis.com/billing/v1/customers",
      data,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "X-com-zoho-subscriptions-organizationid": ZOHO_ORG_ID,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error("Error creating Zoho customer:", error.response?.data || error.message);
    throw error.response?.data || error;
  }
}
