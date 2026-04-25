import { client } from "@/lib/config";

export interface ReputationResult {
  status: string;
  score: number;
}

/**
 * Fetch phone number reputation from Twilio Lookup V2 API
 * Performs a deep check using reputation, caller name (CNAM), and line type intelligence.
 */
export const getNumberReputation = async (phoneNumber: string): Promise<ReputationResult | null> => {
  try {
    // Twilio Lookup V2 with available fields for comprehensive health check
    const lookup = await client.lookups.v2.phoneNumbers(phoneNumber).fetch({
      fields: ["caller_name", "line_type_intelligence"],
    }) as any;

    console.log(`[TwilioLookup] Raw result for ${phoneNumber}:`, JSON.stringify(lookup, null, 2));

    const callerName = lookup.callerName?.callerName || "";
    const lineType = lookup.lineTypeIntelligence?.type || "unknown";

    // Detect spam markers in CNAM (Common for carriers to set 'SPAM LIKELY', 'SCAM LIKELY')
    const isSpamName = /spam|scam|fraud|telemarketer/i.test(callerName);
    
    let status = "unknown";
    let score = 100;

    // If carrier marks it as spam in CNAM, we force 'flagged' status
    if (isSpamName) {
      status = "flagged";
      score = 30; // significantly lower
    }

    // High-risk line types (e.g. non-fixed VOIP) can also impact health
    if (status === "unknown" && (lineType === "voip" || lineType === "non-fixed-voip")) {
       score = 80;
    }

    return {
      status,
      score,
    };
  } catch (error: any) {
    console.error(`[TwilioLookup] Failed for ${phoneNumber}:`, error.message);
    return null;
  }
};
