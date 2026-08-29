import prisma from "../lib/prisma";
import { encryptEIN } from "../utils/encryption";
import twilio from "twilio";
import { envConfig, client as masterClient } from "../lib/config";
import {
    classifyBrand,
    classifyCampaign,
    classifyCustomerProfile,
    type Verdict,
} from "./a2pFailureClassifier";

/**
 * Normalize a phone number to E.164 for Twilio Trust Hub, which rejects
 * anything else with "Phone number is invalid". Heuristic:
 *   - already starts with '+'  → keep as-is
 *   - 10 digits                → assume US, prepend +1
 *   - 11 digits starting with 1 → US with country code, prepend +
 *   - else                     → best-effort strip leading zeros and hope
 *                                the caller supplied a country code
 * Not exhaustive — a proper international-phone parser (libphonenumber)
 * would be more robust but adds a dep. For the US-focused product this
 * covers the common cases.
 */
const normalizePhoneE164 = (raw: string): string => {
    const digits = raw.replace(/\D/g, "");
    if (raw.trim().startsWith("+")) return raw.trim();
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    // Fallback: strip leading zero(s) so numbers like "03152557056" don't
    // reach Twilio as "0...". Still requires a country code prefix from
    // the caller, but avoids the trivial leading-0 rejection.
    return `+${digits.replace(/^0+/, "")}`;
};

export interface A2PBusinessDetails {
    legalBusinessName: string;
    businessType: string;
    ein: string;
    businessWebsite: string;
    businessAddress: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
    contactFirstName: string;
    contactLastName: string;
    contactEmail: string;
    contactPhone: string;

    // Campaign fields — optional on the initial submit so the existing 3-step
    // wizard keeps working during rollout; the new step 4 populates them.
    // Defaults live in DEFAULT_CAMPAIGN_FIELDS below and are only applied
    // when a caller passes nothing so we never silently overwrite a value
    // the user chose.
    useCase?: string;
    businessIndustry?: string;
    messageSamples?: string[];
    optInDetails?: string;
    optInKeywords?: string[];
    optOutKeywords?: string[];
    helpKeywords?: string[];
    helpMessage?: string;
}

/**
 * Fields required to submit or resubmit the campaign stage. Kept separate
 * from A2PBusinessDetails so the campaign-only resubmit route can validate
 * exactly this shape without pulling in the business fields.
 */
export interface A2PCampaignDetails {
    useCase: string;
    businessIndustry?: string;
    messageSamples: string[];
    optInDetails: string;
    optInKeywords: string[];
    optOutKeywords: string[];
    helpKeywords: string[];
    helpMessage: string;
}

/**
 * Legacy real-estate defaults — the values that were previously hard-coded
 * inside executePhase2. Kept as a fallback so existing in-flight users
 * (rows submitted before the schema change) still get a working campaign
 * on their next status check. The wizard's step 4 replaces these with
 * user-entered values on new submits; the backfill script also seeds
 * existing rows with these values so the UI shows editable state.
 */
export const DEFAULT_CAMPAIGN_FIELDS: A2PCampaignDetails = {
    useCase: "MIXED",
    businessIndustry: "REAL_ESTATE",
    messageSamples: [
        "Hi {name}, this is {agent} following up on the property at {address}. Reply STOP to opt out.",
        "Your showing appointment is confirmed for {date} at {time}. Reply STOP to opt out.",
        "Hi {name}, I wanted to check in regarding your real estate inquiry. Reply STOP to opt out.",
    ],
    optInDetails:
        "Contacts opt-in via lead forms on our website and verbal consent during initial contact.",
    optInKeywords: ["START", "YES"],
    optOutKeywords: ["STOP", "UNSUBSCRIBE", "END", "CANCEL", "QUIT"],
    helpKeywords: ["HELP", "INFO"],
    helpMessage:
        "For help contact support@slingvo.com. Reply STOP to unsubscribe.",
};

/**
 * Twilio's evaluation results list every failed field individually, which
 * produces a wall of text ("Business Name: missing | First Name: missing |
 * Last Name: missing | …" 12+ items long). Collapse them into 2-4 human
 * categories so the UI shows something the user can act on.
 */
const summarizeRejectionFields = (fields: string[]): string => {
    if (!fields.length) return "";
    const lower = fields.map(f => f.toLowerCase());
    const has = (kw: string) => lower.some(f => f.includes(kw));

    const buckets: string[] = [];
    if (has("business name") || has("registration number") || has("business classification") || has("website") || has("industry")) {
        buckets.push("Business info incomplete (name, registration number, website, classification)");
    }
    if (has("first name") || has("last name") || has("email") || has("authorized representative")) {
        buckets.push("Authorized representative details missing (name, email)");
    }
    if (has("address") || has("street") || has("city") || has("postal") || has("zip")) {
        buckets.push("Business address missing or does not match registry");
    }
    if (has("end customer") || has("assigned")) {
        buckets.push("End-customer assignment not specified");
    }

    // Anything that didn't fit a bucket becomes a small "other" tail.
    const unmatched = fields.filter(f => {
        const l = f.toLowerCase();
        return !(
            l.includes("business name") || l.includes("registration number") || l.includes("website") ||
            l.includes("classification") || l.includes("industry") ||
            l.includes("first name") || l.includes("last name") || l.includes("email") || l.includes("authorized representative") ||
            l.includes("address") || l.includes("street") || l.includes("city") || l.includes("postal") || l.includes("zip") ||
            l.includes("end customer") || l.includes("assigned")
        );
    });
    if (unmatched.length > 0 && buckets.length < 4) {
        buckets.push(`Other: ${unmatched.slice(0, 2).join(", ")}${unmatched.length > 2 ? "…" : ""}`);
    }

    return buckets.length ? `Business Profile rejected — ${buckets.join("; ")}.` : "Business Profile was rejected by Twilio.";
};

const getUsAppToPersonUsecase = (businessType: string) => {
    switch(businessType) {
        case 'Sole Proprietor':
            return 'SOLE_PROPRIETOR';
        case 'LLC':
        case 'Corporation':
        case 'Partnership':
        case 'Non-Profit':
        default:
            return 'MIXED';
    }
};

/**
 * Twilio's customer_profile_business_information End User expects the
 * spelled-out business_type value ("Limited Liability Corporation"), NOT
 * the acronym. Verified against the approved Lumina Bridge profile on
 * master. Passing the UI value directly ("LLC") makes the evaluation fail.
 */
const mapBusinessTypeToTwilio = (businessType: string): string => {
    switch (businessType) {
        case 'LLC':
        case 'Limited Liability Corporation':
            return 'Limited Liability Corporation';
        case 'Corporation':
        case 'CORPORATION':
            return 'Corporation';
        case 'Partnership':
        case 'PARTNERSHIP':
            return 'Partnership';
        case 'Sole Proprietor':
        case 'SOLE_PROPRIETOR':
        case 'Sole Proprietorship':
            return 'Sole Proprietorship';
        case 'Non-Profit':
        case 'NON_PROFIT':
        case 'Non-profit Corporation':
            return 'Non-profit Corporation';
        default:
            return businessType;
    }
};

const getBrandType = (businessType: string) => {
    switch(businessType) {
        case 'Sole Proprietor':
            return 'SOLE_PROPRIETOR';
        case 'LLC':
        case 'Corporation':
        case 'Partnership':
        case 'Non-Profit':
        default:
            return 'STANDARD';
    }
};

/**
 * Maps our business-type strings onto the `company_type` attribute Twilio's
 * us_a2p_messaging_profile_information EndUser accepts. Verified by Trust
 * Hub evaluation error 22218 — Twilio's live enum is the short form:
 *   private | public | non-profit | government
 * NOT the "-for-profit" variants some older docs list.
 *
 * We default to "private" — the safe assumption for the real-estate ISVs
 * this product targets. Public companies would additionally require
 * stock_exchange + stock_ticker attributes, which we don't collect.
 */
const getA2pCompanyType = (businessType: string): string => {
    switch (businessType) {
        case 'Non-Profit':
        case 'NON_PROFIT':
        case 'Non-profit Corporation':
            return 'non-profit';
        default:
            return 'private';
    }
};

/**
 * Reads the campaign fields off an A2P_Registration row, falling back to
 * DEFAULT_CAMPAIGN_FIELDS whenever a column is null or empty. This is the
 * bridge between the DB-stored user values and the shape executePhase2
 * needs to hand to Twilio. Non-empty arrays win over the defaults so a
 * user who cleared a field explicitly (e.g. no HELP keywords) doesn't
 * silently get the legacy list back.
 */
function pickCampaignFields(reg: any): A2PCampaignDetails {
    const nonEmpty = <T>(arr: T[] | undefined | null, fallback: T[]): T[] =>
        Array.isArray(arr) && arr.length > 0 ? arr : fallback;
    return {
        useCase: reg.useCase || DEFAULT_CAMPAIGN_FIELDS.useCase,
        businessIndustry: reg.businessIndustry || DEFAULT_CAMPAIGN_FIELDS.businessIndustry,
        messageSamples: nonEmpty(reg.messageSamples, DEFAULT_CAMPAIGN_FIELDS.messageSamples),
        optInDetails: reg.optInDetails || DEFAULT_CAMPAIGN_FIELDS.optInDetails,
        optInKeywords: nonEmpty(reg.optInKeywords, DEFAULT_CAMPAIGN_FIELDS.optInKeywords),
        optOutKeywords: nonEmpty(reg.optOutKeywords, DEFAULT_CAMPAIGN_FIELDS.optOutKeywords),
        helpKeywords: nonEmpty(reg.helpKeywords, DEFAULT_CAMPAIGN_FIELDS.helpKeywords),
        helpMessage: reg.helpMessage || DEFAULT_CAMPAIGN_FIELDS.helpMessage,
    };
}

/**
 * Human-readable campaign description shown to TCR reviewers. TCR expects
 * a plain summary of what the campaign will send; the description is one
 * of the fields TCR humans read when scoring, so we derive it from the
 * use case rather than sending the same real-estate string for every
 * vertical.
 */
function buildCampaignDescription(useCase: string): string {
    switch ((useCase || "").toUpperCase()) {
        case "MARKETING":
            return "Marketing messages, promotions, and product updates to contacts who have opted in.";
        case "SOLE_PROPRIETOR":
        case "LOW_VOLUME":
            return "Low-volume outreach and follow-ups to contacts who have opted in.";
        case "MIXED":
        default:
            return "Sending appointment reminders, follow-ups, and lead outreach messages to contacts who have opted in.";
    }
}

/**
 * Trust Hub policy SIDs. Constants (Twilio-side, not per-account):
 *  - SECONDARY_CUSTOMER_PROFILE — the ISV sub-account Business Profile policy.
 *  - US_A2P_MESSAGING_PROFILE   — the "Standard A2P Profile" bundle that
 *                                 Standard/Low-Volume brands must reference
 *                                 as a2PProfileBundleSid. Not the same as
 *                                 the Customer Profile — Brand Registration
 *                                 rejects with "does not meet this
 *                                 requirement" (error 30794) if you pass
 *                                 the CP SID here.
 */
const POLICY_SECONDARY_CUSTOMER_PROFILE = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const POLICY_US_A2P_MESSAGING_PROFILE   = "RNb0d4771c2c98518d916a3d4cd70a8f8b";

/**
 * Thrown by resubmit* methods when the request can't proceed. The `code`
 * lets the route translate to a specific HTTP status (409 for terminal /
 * not-rejected, 424 for dependency-not-ready) instead of a bare 500.
 */
export class ResubmitError extends Error {
    constructor(
        public readonly code:
            | "NOT_STARTED"
            | "NOT_REJECTED"
            | "TERMINAL"
            | "CP_NOT_APPROVED"
            | "BRAND_NOT_APPROVED"
            | "NO_MESSAGING_SERVICE",
        message: string,
    ) {
        super(message);
        this.name = "ResubmitError";
    }
}

/**
 * Reduces the three per-stage statuses to the existing rollup enum. Any
 * rejection wins over pending; only when every present stage is approved
 * do we return APPROVED. Absent stages (e.g. no campaign yet) don't count
 * against approval — they just mean the flow hasn't reached that step.
 */
function deriveRollupStatus(input: {
    cpStatus: string | null;
    brandStatus: string | null;
    campaignStatus: string | null;
}): "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED" {
    const { cpStatus, brandStatus, campaignStatus } = input;
    if (cpStatus === "twilio-rejected") return "REJECTED";
    if (brandStatus === "FAILED") return "REJECTED";
    if (campaignStatus === "FAILED") return "REJECTED";
    // Approval requires the full chain — CP approved, brand approved, and
    // campaign verified. If any stage is missing or still pending we stay
    // PENDING so the panel keeps showing progress.
    if (
        cpStatus === "twilio-approved" &&
        brandStatus === "APPROVED" &&
        campaignStatus === "VERIFIED"
    ) {
        return "APPROVED";
    }
    return "PENDING";
}

/**
 * Picks the most user-actionable rejection message for the rollup
 * `rejectionReason` column, in the order the user should tackle them:
 * CP first (upstream), then brand, then campaign. The panel reads the
 * per-stage columns directly — this is only for legacy consumers of the
 * flat `rejectionReason` field.
 */
function deriveRollupReason(input: {
    cpVerdict: Verdict | null;
    brandVerdict: Verdict | null;
    campaignVerdict: Verdict | null;
}): string | null {
    if (input.cpVerdict?.userMessage) return input.cpVerdict.userMessage;
    if (input.brandVerdict?.userMessage) return input.brandVerdict.userMessage;
    if (input.campaignVerdict?.userMessage) return input.campaignVerdict.userMessage;
    return null;
}

/**
 * Reconstructs an A2PBusinessDetails from a stored row so resubmit-brand
 * can hand it back through submitA2PRegistration. EIN is passed encrypted
 * — submitA2PRegistration calls encryptEIN() on whatever it receives, so
 * we decrypt here first to avoid double-wrapping. Legacy rows that fail
 * decryption surface an empty EIN, which surfaces as a clear submit error
 * rather than silently corrupting the value.
 */
function registrationRowToDetails(reg: any): A2PBusinessDetails {
    // Local require to avoid a circular import — decryptEIN lives in utils.
    const { decryptEIN } = require("../utils/encryption");
    let einPlain = "";
    try { einPlain = decryptEIN(reg.ein); } catch { einPlain = ""; }
    return {
        legalBusinessName: reg.legalBusinessName,
        businessType: reg.businessType,
        ein: einPlain,
        businessWebsite: reg.businessWebsite,
        businessAddress: reg.businessAddress,
        city: reg.city,
        state: reg.state,
        postalCode: reg.postalCode,
        country: reg.country,
        contactFirstName: reg.contactFirstName,
        contactLastName: reg.contactLastName,
        contactEmail: reg.contactEmail,
        contactPhone: reg.contactPhone,
        useCase: reg.useCase ?? undefined,
        businessIndustry: reg.businessIndustry ?? undefined,
        messageSamples: reg.messageSamples ?? undefined,
        optInDetails: reg.optInDetails ?? undefined,
        optInKeywords: reg.optInKeywords ?? undefined,
        optOutKeywords: reg.optOutKeywords ?? undefined,
        helpKeywords: reg.helpKeywords ?? undefined,
        helpMessage: reg.helpMessage ?? undefined,
    };
}

export class A2PRegistrationService {
    /**
     * Executes the 4-step A2P registration sequence.
     */
    async submitA2PRegistration(userId: string, details: A2PBusinessDetails) {
        console.log(`[A2P Service] Starting registration for user: ${userId}`);

        // 1. Encrypt EIN before saving to DB
        const encryptedEin = encryptEIN(details.ein);

        // Snapshot the pre-existing row so the catch block can preserve
        // any prior Twilio-review rejectionReason across a resubmit that
        // fails at the code level. The upsert below overwrites both fields
        // to PENDING/null, so we capture them here first.
        const priorRegistration = await prisma.a2P_Registration.findUnique({
            where: { userId },
            select: { status: true, rejectionReason: true },
        });

        // Split campaign fields out of the wire payload so we can persist
        // them explicitly. Callers may omit them (existing 3-step wizard);
        // we DON'T fill in defaults here — leaving them null lets the
        // backfill script + executePhase2 fall back to DEFAULT_CAMPAIGN_FIELDS
        // without us prematurely stamping stale values.
        const {
            useCase,
            businessIndustry,
            messageSamples,
            optInDetails,
            optInKeywords,
            optOutKeywords,
            helpKeywords,
            helpMessage,
            ...businessDetails
        } = details;

        const campaignData: Record<string, unknown> = {};
        if (useCase !== undefined) campaignData.useCase = useCase;
        if (businessIndustry !== undefined) campaignData.businessIndustry = businessIndustry;
        if (messageSamples !== undefined) campaignData.messageSamples = messageSamples;
        if (optInDetails !== undefined) campaignData.optInDetails = optInDetails;
        if (optInKeywords !== undefined) campaignData.optInKeywords = optInKeywords;
        if (optOutKeywords !== undefined) campaignData.optOutKeywords = optOutKeywords;
        if (helpKeywords !== undefined) campaignData.helpKeywords = helpKeywords;
        if (helpMessage !== undefined) campaignData.helpMessage = helpMessage;

        // 2. Initialize DB record. A fresh submit (or resubmit) clears the
        //    per-stage rejection state — everything is pending until the
        //    poller writes new verdicts. Campaign fields carry over from the
        //    previous row when the caller omits them (partial resubmit).
        const registration = await prisma.a2P_Registration.upsert({
            where: { userId },
            create: {
                userId,
                ...businessDetails,
                ein: encryptedEin,
                status: "PENDING",
                ...campaignData,
            },
            update: {
                ...businessDetails,
                ein: encryptedEin,
                status: "PENDING",
                rejectionReason: null,
                cpStatus: null,
                cpRejectionReason: null,
                cpRejectionCode: null,
                cpRetriable: null,
                brandStatus: null,
                brandRejectionReason: null,
                brandRejectionCode: null,
                brandRetriable: null,
                campaignStatus: null,
                campaignRejectionReason: null,
                campaignRejectionCode: null,
                campaignRetriable: null,
                ...campaignData,
            }
        });

        // 3. Fetch user's Twilio sub-account credentials
        const integration = await prisma.integration.findFirst({
            where: {
                systemSetting: { userId },
                provider: "TWILIO"
            }
        });

        if (!integration || !integration.credentials) {
            throw new Error("Twilio integration not found for this user.");
        }

        const creds = integration.credentials as any;
        const subClient = twilio(creds.accountSid, creds.authToken);

        // Resubmit cleanup — a previous attempt may have left SIDs in Twilio
        // Trust Hub. Two paths depending on the existing CP's state:
        //
        //   - CP is pending-review / in-review / twilio-approved → PRESERVE.
        //     Its evaluation already passed (or is being reviewed), and
        //     recreating it kicks off another 24-48h review from zero. Skip
        //     Steps 1–1e later and jump straight to recreating the A2P
        //     Messaging Profile bundle and Brand. Caveat: any edits the
        //     admin made to business details WON'T propagate to a reused CP
        //     (Twilio doesn't allow mutating profiles once submitted).
        //   - CP is draft / twilio-rejected / missing → DELETE (best-effort)
        //     and null the SID so Step 1 creates a fresh one below.
        //
        // Brand Registrations aren't deletable via Twilio's API (append-only),
        // and the A2P Messaging Profile trust product isn't persisted in our
        // DB — both are always recreated on every resubmit, orphaning the
        // previous rejected copies server-side (harmless).
        let reuseExistingCp = false;
        const PRESERVE_CP_STATUSES = new Set(["pending-review", "in-review", "twilio-approved"]);
        if (registration.customerProfileSid) {
            let cpStatus: string | null = null;
            try {
                const existing = await subClient.trusthub.v1
                    .customerProfiles(registration.customerProfileSid)
                    .fetch();
                cpStatus = existing.status;
            } catch (err: any) {
                console.warn(`[A2P Service] Cleanup: existing customerProfile ${registration.customerProfileSid} not accessible: ${err.message}`);
            }

            if (cpStatus && PRESERVE_CP_STATUSES.has(cpStatus)) {
                reuseExistingCp = true;
                console.log(`[A2P Service] Cleanup: preserving customerProfile ${registration.customerProfileSid} (status: ${cpStatus}) — skipping CP recreation.`);
            } else {
                try {
                    await subClient.trusthub.v1
                        .customerProfiles(registration.customerProfileSid)
                        .remove();
                    console.log(`[A2P Service] Cleanup: removed stale customerProfile ${registration.customerProfileSid} (status: ${cpStatus ?? "unknown"})`);
                } catch (err: any) {
                    console.warn(`[A2P Service] Cleanup: stale customerProfile ${registration.customerProfileSid} not removed: ${err.message}`);
                }
            }
        }

        // Null the SIDs that are always recreated on resubmit. When reusing
        // the CP we keep customerProfileSid populated; otherwise null it too.
        await prisma.a2P_Registration.update({
            where: { userId },
            data: {
                customerProfileSid: reuseExistingCp ? registration.customerProfileSid : null,
                brandSid: null,
                messagingServiceSid: null,
                campaignSid: null,
            },
        });

        try {
            // Resolve the working Customer Profile SID. When reusing an
            // existing in-review/approved CP, skip Steps 1–1e entirely and
            // jump straight to the A2P Messaging Profile bundle + Brand.
            let customerProfileSid: string;

            if (reuseExistingCp && registration.customerProfileSid) {
                customerProfileSid = registration.customerProfileSid;
                console.log(`[A2P Service] Skipping Steps 1–1e — reusing customerProfile ${customerProfileSid}.`);
            } else {
            // STEP 1: Create Customer Profile (Trust Hub)
            //
            // Policy SID is fixed by Twilio — do NOT search by name. The
            // previous "find by 'business' in friendlyName" heuristic picked
            // up "Australia: Local - Business" and produced an evaluation
            // that checked Australian business fields, causing every A2P
            // submission to reject. RNdfbf3fae0e1107f8aded0e7cead80bf5 is
            // Twilio's Secondary Customer Profile policy — the correct one
            // for ISV sub-accounts submitting a US Business Profile.
            console.log("[A2P Service] Step 1: Creating Customer Profile...");
            const profile = await subClient.trusthub.v1.customerProfiles.create({
                friendlyName: details.legalBusinessName,
                email: details.contactEmail,
                phoneNumber: normalizePhoneE164(details.contactPhone),
                policySid: POLICY_SECONDARY_CUSTOMER_PROFILE,
                statusCallbackUrl: `${envConfig.BACKEND_URL}/api/a2p/webhook`
            } as any);
            customerProfileSid = profile.sid;

            await new Promise(resolve => setTimeout(resolve, 500));

            // STEP 1a: Create Address on the sub-account and wrap it as a
            //          Supporting Document so Trust Hub can attach it to the
            //          Customer Profile. Without this, the profile evaluation
            //          fails with "Business address missing or does not match
            //          registry" — which was the root cause of every A2P
            //          rejection until now.
            console.log("[A2P Service] Step 1a: Creating Address + Supporting Document...");
            const address = await subClient.addresses.create({
                customerName: details.legalBusinessName,
                street: details.businessAddress,
                city: details.city,
                region: details.state,
                postalCode: details.postalCode,
                isoCountry: details.country || 'US',
            });
            const addressDoc = await subClient.trusthub.v1.supportingDocuments.create({
                friendlyName: `${details.legalBusinessName} - Business Address`,
                type: 'customer_profile_address',
                attributes: { address_sids: address.sid },
            } as any);

            // STEP 1b: End User — business_information. Twilio uses this to
            //          verify the entity against public registries. Missing
            //          any of these attributes fails evaluation.
            console.log("[A2P Service] Step 1b: Creating business_information End User...");
            // Attribute names + values verified against the approved
            // "Lumina Bridge" profile on master. Notable gotchas:
            //   - website_url (NOT business_website — Twilio's rejection
            //     copy said "business_website" but the actual attribute
            //     is website_url).
            //   - business_type must be SPELLED OUT ("Limited Liability
            //     Corporation"), not the acronym.
            //   - is_subassigned is not an attribute here at all — it's
            //     apparently supplied elsewhere, if at all.
            //   - business_identity: isv_reseller_or_partner matches the
            //     multi-dialer ISV model (Slingvo owns the parent Twilio
            //     account; sub-account admins are effectively resold).
            const businessInfo = await subClient.trusthub.v1.endUsers.create({
                friendlyName: `${details.legalBusinessName} - Business Info`,
                type: 'customer_profile_business_information',
                attributes: {
                    business_name: details.legalBusinessName,
                    business_registration_number: details.ein,
                    business_registration_identifier: 'EIN',
                    business_type: mapBusinessTypeToTwilio(details.businessType),
                    // Was previously hard-coded to REAL_ESTATE. Now sourced
                    // from the user-picked industry, with the legacy default
                    // as a fallback so the existing 3-step wizard keeps
                    // producing valid submits until step 4 ships.
                    business_industry: details.businessIndustry || DEFAULT_CAMPAIGN_FIELDS.businessIndustry,
                    business_regions_of_operation: 'USA_AND_CANADA',
                    website_url: details.businessWebsite,
                    business_identity: 'isv_reseller_or_partner',
                },
            });

            // STEP 1c: End User — authorized_representative_1.
            //          phone_number MUST be E.164 or Twilio rejects with
            //          "Phone number is invalid".
            console.log("[A2P Service] Step 1c: Creating authorized_representative_1 End User...");
            const authRep = await subClient.trusthub.v1.endUsers.create({
                friendlyName: `${details.contactFirstName} ${details.contactLastName} - Auth Rep`,
                type: 'authorized_representative_1',
                attributes: {
                    job_position: 'Director',
                    phone_number: normalizePhoneE164(details.contactPhone),
                    business_title: 'Director',
                    first_name: details.contactFirstName,
                    last_name: details.contactLastName,
                    email: details.contactEmail,
                },
            });

            // STEP 1c-bis: Resolve the ISV's master Primary Customer Profile SID.
            //          The Secondary Customer Profile (sub-account) must
            //          reference the ISV's approved Primary CP (on master) so
            //          Twilio can chain trust. Without this the evaluation
            //          fails with "The status of the Primary Customer Profile
            //          must be in an approved state or in-review state".
            //
            //          Prefer the pinned env SID for stability; fall back to
            //          discovery so this keeps working if the env isn't set
            //          in an environment. Discovery picks the first
            //          twilio-approved profile in the first page — pin the
            //          env var to avoid picking the wrong one if the master
            //          ever holds more than one.
            console.log("[A2P Service] Step 1c-bis: Resolving master's Primary Customer Profile...");
            let masterPrimarySid = envConfig.TWILIO_MASTER_PRIMARY_CUSTOMER_PROFILE_SID;
            if (!masterPrimarySid) {
                const masterProfiles = await masterClient.trusthub.v1.customerProfiles.list({ limit: 20 });
                const masterPrimary = masterProfiles.find(p => p.status === "twilio-approved");
                if (!masterPrimary) {
                    throw new Error(
                        "No twilio-approved Primary Customer Profile on the master account — " +
                        "the ISV's own Primary Business Profile must be approved before sub-accounts can submit."
                    );
                }
                masterPrimarySid = masterPrimary.sid;
            }

            // STEP 1d: Attach the artifacts to the Customer Profile.
            //          Note: the master Primary CP SID is attached directly
            //          as an entity assignment (Twilio's documented ISV
            //          Secondary → Primary linkage). Do NOT create an EndUser
            //          of type 'primary_customer_profile_information' — that
            //          identity type does not exist and Twilio rejects with
            //          "Identity type not found" (70002).
            console.log("[A2P Service] Step 1d: Attaching entities to Customer Profile...");
            const attach = (objectSid: string) =>
                subClient.trusthub.v1
                    .customerProfiles(customerProfileSid)
                    .customerProfilesEntityAssignments.create({ objectSid });
            await attach(addressDoc.sid);
            await attach(businessInfo.sid);
            await attach(authRep.sid);
            await attach(masterPrimarySid);

            // STEP 1e: Submit the Customer Profile for Twilio review. Until
            //          this transitions to twilio-approved, VI + CNAM stay
            //          locked. Brand can be created before this resolves,
            //          but Brand vetting also depends on the profile being
            //          approved, so it usually fails until then.
            console.log("[A2P Service] Step 1e: Submitting Customer Profile for review...");
            await subClient.trusthub.v1
                .customerProfiles(customerProfileSid)
                .update({ status: 'pending-review' });

            await new Promise(resolve => setTimeout(resolve, 500));
            } // end: create-fresh-CP branch (Steps 1–1e)

            // STEP 1f: Create the US A2P Messaging Profile trust product.
            //          Standard/Low-Volume Standard brands require this as a
            //          SEPARATE bundle from the Customer Profile — passing
            //          the CP SID as a2PProfileBundleSid gets a 30794
            //          rejection ("does not meet this requirement"). The A2P
            //          Messaging Profile carries the company_type attribute
            //          used by the carriers to categorize the sender.
            //
            //          Prerequisites (already satisfied by Steps 1a–1e):
            //            - Customer Profile must be pending-review or approved
            //              before the A2P TP can attach to it.
            console.log("[A2P Service] Step 1f: Creating US A2P Messaging Profile trust product...");
            const a2pTrustProduct = await subClient.trusthub.v1.trustProducts.create({
                friendlyName: `${details.legalBusinessName} - A2P Messaging Profile`,
                email: details.contactEmail,
                policySid: POLICY_US_A2P_MESSAGING_PROFILE,
            });

            // STEP 1f-a: EndUser — us_a2p_messaging_profile_information.
            //            company_type is the only required attribute for
            //            private for-profit / non-profit. Public for-profit
            //            additionally requires stock_exchange + stock_ticker
            //            which we don't collect; that path is out of scope.
            console.log("[A2P Service] Step 1f-a: Creating us_a2p_messaging_profile_information EndUser...");
            const a2pEndUser = await subClient.trusthub.v1.endUsers.create({
                friendlyName: `${details.legalBusinessName} - A2P Profile Info`,
                type: 'us_a2p_messaging_profile_information',
                attributes: {
                    company_type: getA2pCompanyType(details.businessType),
                },
            });

            // STEP 1f-b: Attach the CP and the EndUser to the A2P trust product.
            console.log("[A2P Service] Step 1f-b: Attaching CP + EndUser to A2P trust product...");
            const attachToA2p = (objectSid: string) =>
                subClient.trusthub.v1
                    .trustProducts(a2pTrustProduct.sid)
                    .trustProductsEntityAssignments.create({ objectSid });
            await attachToA2p(customerProfileSid);
            await attachToA2p(a2pEndUser.sid);

            // STEP 1f-c: Submit the A2P trust product for Twilio review.
            console.log("[A2P Service] Step 1f-c: Submitting A2P trust product for review...");
            await subClient.trusthub.v1
                .trustProducts(a2pTrustProduct.sid)
                .update({ status: 'pending-review' });

            // STEP 2: Register Brand — now with the DISTINCT A2P Messaging
            //         Profile bundle SID.
            console.log("[A2P Service] Step 2: Registering Brand...");
            const brand = await subClient.messaging.v1.brandRegistrations.create({
                customerProfileBundleSid: customerProfileSid,
                a2PProfileBundleSid: a2pTrustProduct.sid,
                brandType: getBrandType(details.businessType)
            });

            // Update DB with Phase 1 SIDs
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    customerProfileSid,
                    brandSid: brand.sid,
                    status: "PENDING"
                }
            });

            return { status: "PENDING" };

        } catch (error: any) {
            console.error("[A2P Service] Registration FAILED:", error.message, error.code, error.status);
            // On failure during resubmit: preserve the prior Twilio review
            // rejection reason if we had one, so the user still sees the
            // actionable "why Twilio rejected you" message. Prefix the
            // internal error separately so it's clear this attempt broke
            // before ever reaching Twilio review.
            const priorReason = priorRegistration?.rejectionReason;
            const composedReason = priorReason && priorRegistration?.status === "REJECTED"
                ? `Resubmit failed (${error.message}). Previous rejection: ${priorReason}`
                : error.message;
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    status: "NOT_STARTED",
                    customerProfileSid: null,
                    brandSid: null,
                    messagingServiceSid: null,
                    campaignSid: null,
                    rejectionReason: composedReason,
                }
            });
            throw error;
        }
    }

    /**
     * Executes Steps 3 and 4 (Messaging Service & Campaign) after Brand approval.
     * Reads campaign copy (use case, samples, opt-in/out, help) from the DB
     * row so admins can edit these values at submit time or on resubmit
     * without touching the code path. Falls back to DEFAULT_CAMPAIGN_FIELDS
     * for rows written before the schema change.
     */
    private async executePhase2(userId: string, registration: any, subClient: any) {
        console.log(`[A2P Service] Starting Phase 2 for user: ${userId}`);

        const campaign = pickCampaignFields(registration);

        try {
            // STEP 3: Create Messaging Service
            console.log("[A2P Service] Step 3: Creating Messaging Service...");
            const messagingService = await subClient.messaging.v1.services.create({
                friendlyName: `${registration.legalBusinessName} Messaging Service`,
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // STEP 4: Submit Campaign
            console.log("[A2P Service] Step 4: Submitting Campaign...");
            const campaignResource = await subClient.messaging.v1
                .services(messagingService.sid)
                .usAppToPerson.create({
                    brandRegistrationSid: registration.brandSid,
                    // Description is derived from the user-picked use case
                    // rather than hard-coded so different verticals get
                    // TCR-appropriate copy.
                    description: buildCampaignDescription(campaign.useCase),
                    messageSamples: campaign.messageSamples,
                    // usAppToPersonUsecase preferred: user-selected use case
                    // when it maps to a TCR enum, else fall back to the
                    // legacy businessType-derived value.
                    usAppToPersonUsecase: campaign.useCase || getUsAppToPersonUsecase(registration.businessType),
                    messageFlow: campaign.optInDetails,
                    hasEmbeddedLinks: false,
                    hasEmbeddedPhone: false,
                    optInMessage: `You have opted in to receive messages. Reply ${campaign.optOutKeywords[0] || "STOP"} to unsubscribe.`,
                    optOutMessage: `You have been unsubscribed. Reply ${campaign.optInKeywords[0] || "START"} to resubscribe.`,
                    helpMessage: campaign.helpMessage,
                    optInKeywords: campaign.optInKeywords,
                    optOutKeywords: campaign.optOutKeywords,
                    helpKeywords: campaign.helpKeywords,
                    subscriberOptIn: true,
                    subscriberOptOut: true,
                    subscriberHelp: true
                } as any);

            // Update DB with Phase 2 SIDs
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    messagingServiceSid: messagingService.sid,
                    campaignSid: campaignResource.sid,
                    status: "PENDING", // Still pending final campaign approval
                    // Fresh campaign submission — clear any prior rejection
                    // state so the panel doesn't show stale copy while TCR
                    // reviews the new campaign.
                    campaignStatus: "IN_PROGRESS",
                    campaignRejectionReason: null,
                    campaignRejectionCode: null,
                    campaignRetriable: null,
                }
            });

            console.log(`[A2P Service] Phase 2 completed for user: ${userId}`);
        } catch (error: any) {
            console.error("[A2P Service] Phase 2 FAILED:", error.message, error.code, error.status);
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    rejectionReason: `Phase 2 Error: ${error.message}`
                }
            });
        }
    }

    /**
     * Polls Twilio for status updates and mirrors them onto the local A2P row.
     *
     * A2P has THREE independent Twilio / TCR resources that can be rejected:
     *   - Customer Profile (BU… SID)         — vetted by Twilio itself.
     *   - Brand Registration (BN… SID)       — vetted by TCR / carriers.
     *   - Campaign (QE… under Messaging Svc) — vetted by TCR / carriers.
     *
     * Each stage's raw Twilio response is fed through a2pFailureClassifier
     * so we persist BOTH the canonical status AND a stage-level verdict
     * (retriable + human message + suggested fields for the resubmit form).
     * The panel reads these per-stage columns directly; the rollup `status`
     * column stays for backwards compat and is derived from the three
     * stages.
     */
    async checkA2PStatus(userId: string) {
        const reg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!reg) return "NOT_STARTED";
        // APPROVED is truly terminal — skip the network round-trip.
        // REJECTED is NOT — we want to keep the classifier verdict fresh so
        // taxonomy updates and Twilio's evaluation edits actually surface
        // on the next status fetch.
        if (reg.status === "APPROVED") return "APPROVED";

        const integration = await prisma.integration.findFirst({
            where: { systemSetting: { userId }, provider: "TWILIO" }
        });
        if (!integration?.credentials) return reg.status;

        const creds = integration.credentials as any;
        const subClient = twilio(creds.accountSid, creds.authToken);

        // Track per-stage status + verdict as we probe Twilio; single DB
        // update at the end so the row moves atomically.
        let cpStatus: string | null = reg.cpStatus;
        let brandStatus: string | null = reg.brandStatus;
        let campaignStatus: string | null = reg.campaignStatus;
        let cpVerdict: Verdict | null = null;
        let brandVerdict: Verdict | null = null;
        let campaignVerdict: Verdict | null = null;
        let customerProfileApproved = reg.customerProfileApproved;

        try {
            // ---- 1) Customer Profile ------------------------------------
            if (reg.customerProfileSid) {
                const profile = await subClient.trusthub.v1
                    .customerProfiles(reg.customerProfileSid)
                    .fetch();
                cpStatus = profile.status;
                console.log(`[A2P Service] Customer Profile ${reg.customerProfileSid} status: ${cpStatus}`);

                if (cpStatus === "twilio-approved") customerProfileApproved = true;

                // Only fetch evaluation detail when actually rejected — the
                // list endpoint is a separate paid API call, no reason to
                // hit it when the profile is happily under review.
                let latestEval: any = null;
                if (cpStatus === "twilio-rejected") {
                    try {
                        const evals = await subClient.trusthub.v1
                            .customerProfiles(reg.customerProfileSid)
                            .customerProfilesEvaluations.list({ limit: 3 });
                        latestEval = evals.find(e => e.status === "noncompliant") || evals[0] || null;
                    } catch { /* best-effort */ }
                }
                cpVerdict = classifyCustomerProfile({
                    customerProfile: { status: cpStatus },
                    latestEvaluation: latestEval,
                });
            }

            // ---- 2) Brand -----------------------------------------------
            // Only fetch when a brand exists AND the CP is at least
            // pending-review — a twilio-rejected CP makes brand progression
            // moot and we don't want stale brand verdicts overwriting the
            // CP one.
            if (reg.brandSid && cpStatus !== "twilio-rejected") {
                const brand = await subClient.messaging.v1.brandRegistrations(reg.brandSid).fetch();
                brandStatus = brand.status;
                console.log(`[A2P Service] Brand status: ${brandStatus}`);

                brandVerdict = classifyBrand({
                    brand: {
                        status: brandStatus,
                        failureReason: (brand as any).failureReason,
                        errorDetail: (brand as any).errorDetail,
                    },
                });

                // Brand APPROVED triggers Phase 2 the first time we see it.
                // executePhase2 writes its own campaign columns; we skip
                // the classifier for campaign in this tick because the
                // resource was just created and hasn't been evaluated yet.
                if (brandStatus === "APPROVED" && !reg.campaignSid) {
                    await this.executePhase2(userId, reg, subClient);
                }
            }

            // ---- 3) Campaign --------------------------------------------
            // Only meaningful once we have a campaignSid — before that,
            // "waiting for brand" is the state the panel should show and
            // the classifier has nothing to say.
            //
            // Refetch the reg here because executePhase2 above may have
            // just written campaignSid — otherwise the first tick after
            // brand approval would always miss the campaign check.
            const latestReg = await prisma.a2P_Registration.findUnique({ where: { userId } });
            const campaignSid = latestReg?.campaignSid ?? reg.campaignSid;
            const messagingServiceSid = latestReg?.messagingServiceSid ?? reg.messagingServiceSid;
            if (campaignSid && messagingServiceSid) {
                try {
                    const campaign = await subClient.messaging.v1
                        .services(messagingServiceSid)
                        .usAppToPerson(campaignSid)
                        .fetch();
                    campaignStatus = (campaign as any).campaignStatus || null;
                    console.log(`[A2P Service] Campaign status: ${campaignStatus}`);
                    campaignVerdict = classifyCampaign({
                        campaign: {
                            campaignStatus,
                            rejectionReason: (campaign as any).rejectionReason,
                        },
                    });
                } catch (err: any) {
                    // Campaign endpoint can 404 briefly right after Phase 2
                    // if TCR hasn't propagated. Non-fatal.
                    console.warn(`[A2P Service] Campaign fetch failed: ${err.message}`);
                }
            }
        } catch (error: any) {
            console.error("[A2P Service] Status check error:", error.message);
        }

        // ---- Persist per-stage columns + derived rollup -----------------
        const rollupStatus = deriveRollupStatus({ cpStatus, brandStatus, campaignStatus });
        const rollupReason = deriveRollupReason({ cpVerdict, brandVerdict, campaignVerdict });

        await prisma.a2P_Registration.update({
            where: { userId },
            data: {
                status: rollupStatus,
                rejectionReason: rollupReason,
                customerProfileApproved,
                cpStatus,
                cpRejectionReason: cpVerdict?.userMessage || null,
                cpRejectionCode: cpVerdict?.code || null,
                cpRetriable: cpVerdict?.retriable ?? null,
                brandStatus,
                brandRejectionReason: brandVerdict?.userMessage || null,
                brandRejectionCode: brandVerdict?.code || null,
                brandRetriable: brandVerdict?.retriable ?? null,
                campaignStatus,
                campaignRejectionReason: campaignVerdict?.userMessage || null,
                campaignRejectionCode: campaignVerdict?.code || null,
                campaignRetriable: campaignVerdict?.retriable ?? null,
            },
        });

        return rollupStatus;
    }

    /**
     * Resubmit ONLY the Customer Profile after a twilio-rejection. Refuses
     * if the last classifier verdict marked the CP terminal. Because
     * Twilio doesn't allow mutating an already-submitted CP, the underlying
     * flow deletes the old one and creates a fresh one — we route the call
     * through submitA2PRegistration so all the cleanup + entity-assignment
     * logic is reused. Business fields come from the user's edited form;
     * campaign fields carry over from the row so we don't zero them out.
     */
    async resubmitCustomerProfile(userId: string, details: A2PBusinessDetails) {
        const reg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!reg) throw new ResubmitError("NOT_STARTED", "No A2P registration to resubmit.");
        if (reg.cpStatus !== "twilio-rejected") {
            throw new ResubmitError(
                "NOT_REJECTED",
                "Customer Profile isn't in a rejected state — nothing to resubmit."
            );
        }
        if (reg.cpRetriable === false) {
            throw new ResubmitError(
                "TERMINAL",
                reg.cpRejectionReason || "This rejection cannot be retried self-serve — contact support."
            );
        }

        // Force fresh-CP path: null the SID so submitA2PRegistration's
        // resubmit-cleanup branch takes the "delete stale + create new"
        // path, which is what CP-rejection recovery requires.
        await prisma.a2P_Registration.update({
            where: { userId },
            data: { customerProfileSid: null },
        });

        // Preserve stored campaign fields so the user isn't retyping them.
        const merged: A2PBusinessDetails = {
            ...details,
            useCase: reg.useCase ?? undefined,
            businessIndustry: reg.businessIndustry ?? undefined,
            messageSamples: reg.messageSamples,
            optInDetails: reg.optInDetails ?? undefined,
            optInKeywords: reg.optInKeywords,
            optOutKeywords: reg.optOutKeywords,
            helpKeywords: reg.helpKeywords,
            helpMessage: reg.helpMessage ?? undefined,
        };

        await prisma.a2P_Registration.update({
            where: { userId },
            data: { lastResubmitAt: new Date() },
        });

        return this.submitA2PRegistration(userId, merged);
    }

    /**
     * Resubmit ONLY the Brand + A2P Messaging Profile. Reuses the existing
     * approved Customer Profile — that's the whole point of the split.
     * Brand registrations are append-only in Twilio, so the previous BN…
     * SID is orphaned; a new one is created against the same CP bundle.
     * Charges a real TCR fee — the route confirms with the user first.
     */
    async resubmitBrand(userId: string) {
        const reg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!reg) throw new ResubmitError("NOT_STARTED", "No A2P registration to resubmit.");
        if (reg.brandStatus !== "FAILED") {
            throw new ResubmitError(
                "NOT_REJECTED",
                "Brand isn't in a failed state — nothing to resubmit."
            );
        }
        if (reg.brandRetriable === false) {
            throw new ResubmitError(
                "TERMINAL",
                reg.brandRejectionReason || "This brand rejection cannot be retried self-serve — contact support."
            );
        }
        if (!reg.customerProfileApproved) {
            throw new ResubmitError(
                "CP_NOT_APPROVED",
                "Fix and resubmit your Business Profile first — Brand can't be resubmitted until it's approved."
            );
        }

        await prisma.a2P_Registration.update({
            where: { userId },
            data: {
                brandResubmitCount: { increment: 1 },
                lastResubmitAt: new Date(),
                // Clear the failure state so the panel shows "syncing" while
                // Twilio processes the new submission.
                brandStatus: null,
                brandRejectionReason: null,
                brandRejectionCode: null,
                brandRetriable: null,
            },
        });

        // Rebuild the details struct from the row and hand back through
        // the shared submit flow. The CP-preserve path fires because the
        // stored customerProfileSid still points at the approved CP.
        const details = registrationRowToDetails(reg);
        return this.submitA2PRegistration(userId, details);
    }

    /**
     * Resubmit ONLY the campaign. Reuses the approved brand + existing
     * messaging service; only the usAppToPerson resource is deleted and
     * recreated with the new samples / opt-in / keywords / etc. No TCR
     * fee.
     */
    async resubmitCampaign(userId: string, campaign: A2PCampaignDetails) {
        const reg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!reg) throw new ResubmitError("NOT_STARTED", "No A2P registration to resubmit.");
        if (reg.campaignStatus !== "FAILED") {
            throw new ResubmitError(
                "NOT_REJECTED",
                "Campaign isn't in a failed state — nothing to resubmit."
            );
        }
        if (reg.campaignRetriable === false) {
            throw new ResubmitError(
                "TERMINAL",
                reg.campaignRejectionReason || "This campaign rejection cannot be retried self-serve — contact support."
            );
        }
        if (!reg.brandSid || reg.brandStatus !== "APPROVED") {
            throw new ResubmitError(
                "BRAND_NOT_APPROVED",
                "Brand must be approved before the campaign can be resubmitted."
            );
        }
        if (!reg.messagingServiceSid) {
            throw new ResubmitError(
                "NO_MESSAGING_SERVICE",
                "Messaging service missing — please contact support."
            );
        }

        // Persist the new campaign fields first so executePhase2 picks them
        // up. Also increments the counter + resets the campaign SID so
        // the next status check knows to look for a fresh resource.
        await prisma.a2P_Registration.update({
            where: { userId },
            data: {
                useCase: campaign.useCase,
                businessIndustry: campaign.businessIndustry ?? reg.businessIndustry,
                messageSamples: campaign.messageSamples,
                optInDetails: campaign.optInDetails,
                optInKeywords: campaign.optInKeywords,
                optOutKeywords: campaign.optOutKeywords,
                helpKeywords: campaign.helpKeywords,
                helpMessage: campaign.helpMessage,
                campaignResubmitCount: { increment: 1 },
                lastResubmitAt: new Date(),
                campaignSid: null,
                campaignStatus: null,
                campaignRejectionReason: null,
                campaignRejectionCode: null,
                campaignRetriable: null,
            },
        });

        // Best-effort: delete the old usAppToPerson resource so we're not
        // keeping a rejected campaign attached to a live messaging service.
        // Twilio allows deletion of failed campaigns; if it fails, the
        // orphan is harmless — the new campaign becomes the active one.
        const integration = await prisma.integration.findFirst({
            where: { systemSetting: { userId }, provider: "TWILIO" },
        });
        if (!integration?.credentials) {
            throw new Error("Twilio integration not found for this user.");
        }
        const creds = integration.credentials as any;
        const subClient = twilio(creds.accountSid, creds.authToken);
        if (reg.campaignSid) {
            try {
                await subClient.messaging.v1
                    .services(reg.messagingServiceSid)
                    .usAppToPerson(reg.campaignSid)
                    .remove();
            } catch (err: any) {
                console.warn(`[A2P Service] Old campaign cleanup failed (non-fatal): ${err.message}`);
            }
        }

        // executePhase2 creates a fresh Messaging Service each time; for a
        // campaign-only resubmit we want to reuse the existing service so
        // downstream number attachments don't need to be rewired. Call the
        // narrower helper below instead.
        const updated = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!updated) throw new Error("Registration row disappeared during resubmit.");
        await this.createCampaignOnExistingService(userId, updated, subClient);
        return { status: "PENDING" };
    }

    /**
     * Creates a usAppToPerson campaign on the messaging service already
     * attached to the registration. Used by resubmitCampaign so we don't
     * churn the messaging service SID (which would break number
     * attachments configured against it).
     */
    private async createCampaignOnExistingService(userId: string, registration: any, subClient: any) {
        const campaign = pickCampaignFields(registration);
        try {
            const campaignResource = await subClient.messaging.v1
                .services(registration.messagingServiceSid)
                .usAppToPerson.create({
                    brandRegistrationSid: registration.brandSid,
                    description: buildCampaignDescription(campaign.useCase),
                    messageSamples: campaign.messageSamples,
                    usAppToPersonUsecase: campaign.useCase || getUsAppToPersonUsecase(registration.businessType),
                    messageFlow: campaign.optInDetails,
                    hasEmbeddedLinks: false,
                    hasEmbeddedPhone: false,
                    optInMessage: `You have opted in to receive messages. Reply ${campaign.optOutKeywords[0] || "STOP"} to unsubscribe.`,
                    optOutMessage: `You have been unsubscribed. Reply ${campaign.optInKeywords[0] || "START"} to resubscribe.`,
                    helpMessage: campaign.helpMessage,
                    optInKeywords: campaign.optInKeywords,
                    optOutKeywords: campaign.optOutKeywords,
                    helpKeywords: campaign.helpKeywords,
                    subscriberOptIn: true,
                    subscriberOptOut: true,
                    subscriberHelp: true,
                } as any);
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    campaignSid: campaignResource.sid,
                    campaignStatus: "IN_PROGRESS",
                    status: "PENDING",
                },
            });
        } catch (error: any) {
            console.error("[A2P Service] Campaign resubmit FAILED:", error.message, error.code, error.status);
            await prisma.a2P_Registration.update({
                where: { userId },
                data: { rejectionReason: `Campaign resubmit error: ${error.message}` },
            });
            throw error;
        }
    }
}

export const a2pRegistrationService = new A2PRegistrationService();
