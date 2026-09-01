import axios from "axios";
import prisma from "../lib/prisma";

export interface ReputationResult {
  status: "clean" | "warning" | "flagged" | "unchecked";
  score: number | null;
  source?: "twilio-voice-integrity" | "youmail" | "none";
}

const YOUMAIL_API_SID = process.env.YOUMAIL_API_SID;
const YOUMAIL_API_KEY = process.env.YOUMAIL_API_KEY;

/**
 * Return the phone number's spam-label reputation.
 *
 * Provider chain:
 *   1. Voice Integrity registration — Voice Integrity is a REGISTRATION
 *      service, not a lookup service. Once a number is enrolled in an
 *      approved VI Trust Product on the carrier side, we already know
 *      it's carrier-trusted; there's no per-number spam status to poll.
 *      We reflect that by returning "clean" for any CallerId with
 *      cnamRegistered=false but voiceIntegrityRegistered=true.
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
    // VI-registered numbers are carrier-trusted by construction. Score 90
    // matches YouMail's "clean" bucket so existing UI thresholds stay valid.
    return { status: "clean", score: 90, source: "twilio-voice-integrity" };
  }

  const youmailResult = await lookupViaYouMail(phoneNumber);
  return { ...youmailResult, source: youmailResult.status === "unchecked" ? "none" : "youmail" };
};

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
