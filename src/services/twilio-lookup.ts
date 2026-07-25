import { client } from "@/lib/config";

export interface ReputationResult {
  status: "clean" | "warning" | "flagged" | "unchecked";
  score: number | null;
}

/**
 * Fetch phone number reputation from Twilio Lookup V2 API using
 * phone_number_quality_score (First Orion / T-Mobile carrier data).
 *
 * Always returns a result — never throws. On API failure or when the
 * quality-score add-on is unavailable, returns status "unchecked" so
 * callers can distinguish "no data" from "confirmed clean".
 */
export const getNumberReputation = async (phoneNumber: string): Promise<ReputationResult> => {
  try {
    const lookup = await client.lookups.v2.phoneNumbers(phoneNumber).fetch({
      fields: "caller_name,line_type_intelligence,phone_number_quality_score",
    }) as any;

    console.log(`[TwilioLookup] Raw result for ${phoneNumber}:`, JSON.stringify(lookup, null, 2));

    const quality = lookup.phoneNumberQualityScore;

    // SDK may return camelCase or snake_case depending on version — handle both.
    // quality_category values: "very_high" | "high" | "medium" | "low" | "very_low"
    // quality_score: 0–1 float, higher = better (less spammy)
    const qualityCategory: string | null =
      quality?.qualityCategory ?? quality?.quality_category ?? null;
    const rawScore: number | null =
      quality?.qualityScore ?? quality?.quality_score ?? null;

    // No usable data: error_code present, unsupported number type, or no history
    if (!qualityCategory && rawScore == null) {
      return { status: "unchecked", score: null };
    }

    const qualityScore: number | null = rawScore != null
      ? Math.round(rawScore * 100)
      : null;

    let status: ReputationResult["status"];
    if (qualityCategory === "very_low" || qualityCategory === "low") status = "flagged";
    else if (qualityCategory === "medium")                            status = "warning";
    else if (qualityCategory === "high" || qualityCategory === "very_high") status = "clean";
    else                                                              status = "unchecked";

    return { status, score: qualityScore };
  } catch (error: any) {
    console.error(`[TwilioLookup] Failed for ${phoneNumber}:`, error.message);
    return { status: "unchecked", score: null };
  }
};
