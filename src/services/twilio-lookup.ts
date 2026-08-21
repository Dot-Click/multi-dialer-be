import axios from "axios";
import prisma from "../lib/prisma";
import { client as masterClient } from "../lib/config";
import { getStatus as getVoiceIntegrityStatus } from "./voiceIntegrity.service";

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
 *   1. Twilio Voice Integrity (Lookup v2, line_status_verification) — used
 *      when the owning admin has an approved Voice Integrity trust product.
 *      This is the authoritative per-carrier signal.
 *   2. YouMail Data API — fallback for numbers whose admin hasn't enrolled
 *      in Voice Integrity, or when the Twilio call itself fails.
 *
 * The shape (`status`, `score`) is preserved so dialerHealth.job.ts and the
 * frontend deliverability badges don't need to change.
 *
 * Never throws.
 */
export const getNumberReputation = async (phoneNumber: string): Promise<ReputationResult> => {
  const adminUserId = await getAdminUserIdForNumber(phoneNumber);
  if (adminUserId) {
    const viStatus = await getVoiceIntegrityStatus(adminUserId).catch(() => null);
    if (viStatus?.status === "twilio-approved") {
      const viResult = await lookupViaVoiceIntegrity(phoneNumber);
      if (viResult) return { ...viResult, source: "twilio-voice-integrity" };
    }
  }

  const youmailResult = await lookupViaYouMail(phoneNumber);
  return { ...youmailResult, source: youmailResult.status === "unchecked" ? "none" : "youmail" };
};

/**
 * Find the admin who owns this number (via CallerId → SystemSetting → userId).
 * Needed to know which admin's Voice Integrity trust product to consult.
 */
async function getAdminUserIdForNumber(phoneNumber: string): Promise<string | null> {
  const cid = await prisma.callerId.findFirst({
    where: { twillioNumber: phoneNumber },
    select: { systemSetting: { select: { userId: true } } },
  });
  return cid?.systemSetting.userId ?? null;
}

/**
 * Twilio Lookup v2 with the line_status_verification field returns
 * per-carrier spam label info (T-Mobile / AT&T / Verizon). Only meaningful
 * once the number is registered with Voice Integrity.
 */
async function lookupViaVoiceIntegrity(
  phoneNumber: string
): Promise<Omit<ReputationResult, "source"> | null> {
  try {
    const lookup = await masterClient.lookups.v2
      .phoneNumbers(phoneNumber)
      .fetch({ fields: "line_status_verification" as any });

    const info = (lookup as any).lineStatusVerification;
    if (!info) return null;

    // Twilio surfaces per-carrier verification objects. Any "spam"-ish
    // classification collapses to flagged; any "warning" to warning; else clean.
    const verdicts: string[] = [];
    for (const carrierKey of Object.keys(info)) {
      const label = (info[carrierKey]?.classification || info[carrierKey]?.status || "")
        .toString()
        .toLowerCase();
      if (label) verdicts.push(label);
    }

    if (verdicts.length === 0) return null;

    const flagged = verdicts.some(v => v.includes("spam") || v.includes("scam") || v.includes("fraud"));
    if (flagged) return { status: "flagged", score: 10 };

    const warned = verdicts.some(v => v.includes("nuisance") || v.includes("telemarket") || v.includes("warning"));
    if (warned) return { status: "warning", score: 45 };

    return { status: "clean", score: 90 };
  } catch (error: any) {
    console.warn(`[TwilioLookup] Voice Integrity lookup failed for ${phoneNumber}: ${error?.message}`);
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
