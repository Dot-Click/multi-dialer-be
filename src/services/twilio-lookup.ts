import axios from "axios";
import prisma from "../lib/prisma";
import { client as masterClient } from "../lib/config";

export interface ReputationResult {
  status: "clean" | "warning" | "flagged" | "unchecked";
  score: number | null;
  source?: "twilio-voice-integrity" | "twilio-quality-score" | "youmail" | "none";
}

const YOUMAIL_API_SID = process.env.YOUMAIL_API_SID;
const YOUMAIL_API_KEY = process.env.YOUMAIL_API_KEY;

/**
 * Return the phone number's spam-label reputation.
 *
 * Provider chain:
 *   1. Voice Integrity registration + Twilio's phone_number_quality_score.
 *      VI is a REGISTRATION service, not a lookup service, so registered
 *      numbers are carrier-trusted by construction. We assume "clean" and
 *      then let Twilio's paid Lookup v2 quality score DOWNGRADE the status
 *      if it detects an issue (score is a Twilio-computed number reflecting
 *      carrier-facing risk). The quality-score call is best-effort — if it
 *      fails or the shape is unexpected, we fall back to the VI baseline
 *      of "clean".
 *   2. YouMail Data API — fallback for numbers whose admin hasn't enrolled
 *      in Voice Integrity (or whose enrolment is still pending).
 *
 * Never throws.
 */
export const getNumberReputation = async (phoneNumber: string): Promise<ReputationResult> => {
  const cid = await prisma.callerId.findFirst({
    where: { twillioNumber: phoneNumber },
    select: { voiceIntegrityRegistered: true },
  });

  if (cid?.voiceIntegrityRegistered) {
    // Start from the VI "clean" baseline, then check Twilio's quality score
    // as a supplementary risk signal. Only downgrade — a good score just
    // confirms what we already assumed.
    const quality = await lookupQualityScore(phoneNumber);
    if (quality) return quality;
    return { status: "clean", score: 90, source: "twilio-voice-integrity" };
  }

  const youmailResult = await lookupViaYouMail(phoneNumber);
  return { ...youmailResult, source: youmailResult.status === "unchecked" ? "none" : "youmail" };
};

/**
 * Twilio Lookup v2 `phone_number_quality_score` — a paid field
 * (~$0.005/lookup) that returns Twilio's own carrier-facing risk score.
 *
 * Twilio's response shape (from the docs) puts the score under
 * `phone_number_quality_score.score` on a 0-100 scale, higher = safer.
 * Bucket thresholds match YouMail's existing behavior so downstream UI
 * doesn't change:
 *   >= 70   → clean
 *   40-69  → warning
 *    < 40  → flagged
 *
 * Returns null on any failure so the caller can fall back to the VI
 * baseline. Never throws.
 */
async function lookupQualityScore(phoneNumber: string): Promise<ReputationResult | null> {
  try {
    const lookup = await masterClient.lookups.v2
      .phoneNumbers(phoneNumber)
      .fetch({ fields: "phone_number_quality_score" as any });

    const raw = (lookup as any).phoneNumberQualityScore;
    const score =
      typeof raw?.score === "number"
        ? raw.score
        : typeof raw?.related_information?.score === "number"
        ? raw.related_information.score
        : null;
    if (score === null) return null;

    const status: ReputationResult["status"] =
      score >= 70 ? "clean" : score >= 40 ? "warning" : "flagged";
    return { status, score, source: "twilio-quality-score" };
  } catch (error: any) {
    console.warn(
      `[TwilioLookup] phone_number_quality_score lookup failed for ${phoneNumber}: ${error?.message}`
    );
    return null;
  }
}

/**
 * Legacy YouMail path — unchanged behavior from before the provider chain.
 * Kept as the fallback for admins who haven't enrolled in Voice Integrity.
 */
async function lookupViaYouMail(phoneNumber: string): Promise<Omit<ReputationResult, "source">> {
  try {
    if (!YOUMAIL_API_SID || !YOUMAIL_API_KEY) {
      return { status: "unchecked", score: null };
    }

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

    const data = response.data as any;

    if (data.statusCode !== 10000) return { status: "unchecked", score: null };
    if (!data.recordFound) return { status: "unchecked", score: null };

    const level: number = data.spamRisk?.level ?? 0;
    if (level === 2) return { status: "flagged", score: 10 };
    if (level === 1) return { status: "warning", score: 45 };
    return { status: "clean", score: 90 };
  } catch (error: any) {
    if (error.response?.status === 404) return { status: "unchecked", score: null };
    console.error(`[YouMailLookup] Failed for ${phoneNumber}:`, error.message);
    return { status: "unchecked", score: null };
  }
}
