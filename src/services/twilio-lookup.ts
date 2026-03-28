import { client } from "@/lib/config";

export interface ReputationResult {
  status: string;
  score: number;
}

/**
 * Fetch phone number reputation from Twilio Lookup V2 API
 * Requires the "reputation" field to be enabled in Twilio.
 */
export const getNumberReputation = async (phoneNumber: string): Promise<ReputationResult | null> => {
  try {
    if (!phoneNumber) return null;
    
    // Twilio Lookup V2 Reputation check
    // We cast to 'any' and then access property because the official SDK types 
    // are often behind the latest API features like 'reputation'.
    const lookup = await client.lookups.v2.phoneNumbers(phoneNumber).fetch({
      fields: "reputation",
    }) as { reputation?: { status: string; score: number } };

    return {
      status: lookup.reputation?.status || "unknown",
      score: lookup.reputation?.score || 100,
    };
  } catch (error: any) {
    console.error(`[TwilioLookup] Failed for ${phoneNumber}:`, error.message);
    return null;
  }
};
