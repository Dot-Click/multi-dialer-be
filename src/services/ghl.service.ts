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

        const GHL_AGENCY_ID = envConfig.GHL_AGENCY_ID;
        let companyId = GHL_AGENCY_ID;

        // If companyId is not provided in env, try to discover it automatically
        if (!companyId) {
            console.log("[GHLService] Agency ID not found in config, attempting auto-discovery...");
            const searchRes: any = await axios.get(`${GHL_BASE_URL}/locations/search`, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Version: "2021-07-28",
                },
                params: { limit: 1 }
            });
            
            // In v2, the search/list response often contains the companyId in the location objects
            if (searchRes.data?.locations?.length > 0) {
                companyId = searchRes.data.locations[0].companyId;
                console.log(`[GHLService] Discovered Agency ID: ${companyId}`);
            } else {
                throw new Error("Could not discover GoHighLevel Agency ID. Please set GHL_AGENCY_ID in your .env file.");
            }
        }

        const response: any = await axios.post(
            `${GHL_BASE_URL}/locations/`,
            {
                companyId,
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
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Version: "2021-07-28",
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
