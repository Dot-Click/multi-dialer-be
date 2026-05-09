import axios from "axios";
import { envConfig } from "../lib/config";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";

interface GHLLocationDetails {
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    website?: string;
    timezone?: string;
}

/**
 * Creates a GoHighLevel Sub-Account (Location).
 * @param details Location details
 * @returns The created location details including locationId
 */
export async function createGHLSubAccount(details: GHLLocationDetails) {
    try {
        const apiKey = envConfig.GHL_AGENCY_API_KEY;
        if (!apiKey) {
            throw new Error("GHL_AGENCY_API_KEY is not set.");
        }

        console.log(`[GHLService] Creating sub-account for: ${details.name}`);

        const response = await axios.post(
            `${GHL_BASE_URL}/locations/`,
            {
                name: details.name,
                email: details.email,
                phone: details.phone || "",
                address: details.address || "",
                city: details.city || "",
                state: details.state || "",
                country: details.country || "US",
                postalCode: details.postalCode || "",
                website: details.website || "",
                timezone: details.timezone || "America/New_York",
                // companyId is required for Agency API calls to create locations
                // If not provided in body, v2 API usually expects it.
                // We might need to fetch the companyId first or ask the user for it.
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Version: "2021-07-28", // GHL API Version
                    "Content-Type": "application/json",
                },
            }
        );

        console.log(`[GHLService] Sub-account created: ${response.data.location.id}`);
        
        return response.data.location;
    } catch (error: any) {
        console.error(`[GHLService] Error creating sub-account:`, error.response?.data || error.message);
        throw new Error(`GHL sub-account creation failed: ${error.response?.data?.message || error.message}`);
    }
}
