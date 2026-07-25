import axios from "axios";

export interface ReputationResult {
  status: "clean" | "warning" | "flagged" | "unchecked";
  score: number | null;
}

const YOUMAIL_API_SID = process.env.YOUMAIL_API_SID;
const YOUMAIL_API_KEY = process.env.YOUMAIL_API_KEY;

/**
 * Fetch phone number spam reputation from YouMail's Spam Caller API.
 * Covers all major US carriers (AT&T, Verizon, T-Mobile).
 *
 * spamRisk.level: 0 = clean, 1 = probable spam, 2 = confirmed spam
 * recordFound: false = YouMail has no data for this number → "unchecked"
 *
 * Always returns a result — never throws.
 */
export const getNumberReputation = async (phoneNumber: string): Promise<ReputationResult> => {
  try {
    if (!YOUMAIL_API_SID || !YOUMAIL_API_KEY) {
      console.warn("[YouMailLookup] YOUMAIL_API_SID / YOUMAIL_API_KEY not set");
      return { status: "unchecked", score: null };
    }

    // YouMail expects the 10-digit US number without country code or +
    const normalized = phoneNumber.replace(/^\+1/, "").replace(/\D/g, "");

    const response = await axios.get(
      `https://dataapi.youmail.com/api/v2/phone/${normalized}`,
      {
        headers: {
          Accept: "application/json",
          "X-API-SID": YOUMAIL_API_SID,
          "X-API-KEY": YOUMAIL_API_KEY,
        },
        timeout: 10_000,
      }
    );

    const data = response.data;

    // statusCode 10000 = success; anything else is a non-fatal API error
    if (data.statusCode !== 10000) {
      console.warn(`[YouMailLookup] ${phoneNumber} → status ${data.statusCode}`);
      return { status: "unchecked", score: null };
    }

    // recordFound = false → YouMail has no reputation data for this number
    if (!data.recordFound) {
      console.log(`[YouMailLookup] ${phoneNumber} → no record`);
      return { status: "unchecked", score: null };
    }

    const level: number = data.spamRisk?.level ?? 0;
    console.log(`[YouMailLookup] ${phoneNumber} → spamRisk.level=${level}`);

    if (level === 2) return { status: "flagged", score: 10 };
    if (level === 1) return { status: "warning", score: 45 };
    return { status: "clean", score: 90 };

  } catch (error: any) {
    // 404 = number not in YouMail's database
    if (error.response?.status === 404) {
      console.log(`[YouMailLookup] ${phoneNumber} → 404 not found`);
      return { status: "unchecked", score: null };
    }
    console.error(`[YouMailLookup] Failed for ${phoneNumber}:`, error.message);
    return { status: "unchecked", score: null };
  }
};
