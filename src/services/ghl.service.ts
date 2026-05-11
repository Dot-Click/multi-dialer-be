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

        const companyId = envConfig.GHL_AGENCY_ID;
        if (!companyId) {
            throw new Error("GHL_AGENCY_ID is missing from .env. Auto-discovery is not supported in GHL V2; please manually add your Agency ID to the config.");
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
