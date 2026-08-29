/**
 * A2P failure classifier.
 *
 * Takes raw Twilio Trust Hub / TCR responses for each of the three A2P
 * stages (Customer Profile, Brand, Campaign) and produces a structured
 * verdict the panel + resubmit routes can act on:
 *
 *   - status          — canonical stage status string (persisted as-is)
 *   - retriable       — true = user can resubmit; false = terminal
 *   - code            — the Twilio raw failure code we matched on, or null
 *   - userMessage     — human copy shown in the panel
 *   - remediation     — one-line action the user should take
 *   - suggestedFields — form field names to red-highlight on resubmit
 *
 * v1 taxonomy is derived from Twilio + TCR docs and the failure signals
 * we've seen in production so far. Anything unknown falls back to
 * retriable = true — better to over-offer retries than to lock users out
 * of something Twilio would accept. Unknown codes are surfaced with the
 * raw Twilio text so we can grow the taxonomy from real evidence.
 */

export type A2PStage = "customer_profile" | "brand" | "campaign";

export type CpStatus =
    | "draft"
    | "pending-review"
    | "in-review"
    | "twilio-approved"
    | "twilio-rejected";

export type BrandStatus =
    | "PENDING"
    | "IN_REVIEW"
    | "APPROVED"
    | "FAILED"
    | "SUSPENDED";

export type CampaignStatus = "IN_PROGRESS" | "VERIFIED" | "FAILED";

export interface Verdict {
    stage: A2PStage;
    /** null when the stage isn't rejected — panel shows a plain status row. */
    retriable: boolean | null;
    /** Twilio-side failure code we matched on. null for unknown / not rejected. */
    code: string | null;
    /** Copy shown in the panel. Empty when the stage isn't rejected. */
    userMessage: string;
    /** One-line action for the user. Empty when the stage isn't rejected. */
    remediation: string;
    /** Field names to highlight on the resubmit form. */
    suggestedFields: string[];
}

/**
 * Shape of one Twilio Customer Profile evaluation, as returned by
 * `customerProfilesEvaluations.list({ limit })`. Loose typing because
 * the Twilio SDK exposes these as `any` on the evaluation record.
 */
export interface CpEvaluationField {
    passed?: boolean;
    friendly_name?: string;
    object_field?: string;
    failure_reason?: string;
}
export interface CpEvaluationResult {
    fields?: CpEvaluationField[];
}
export interface CpEvaluation {
    status?: string;
    results?: CpEvaluationResult[];
}

export interface CustomerProfileLike {
    status?: string | null;
}
export interface BrandRegistrationLike {
    status?: string | null;
    failureReason?: string | null;
    errorDetail?: string | null;
    tcrId?: string | null;
}
export interface CampaignLike {
    campaignStatus?: string | null;
    rejectionReason?: string | null;
    errors?: unknown;
}

// ---------------------------------------------------------------------------
// Customer Profile
// ---------------------------------------------------------------------------

/**
 * The buckets we recognise on a CP rejection. Order matters — the first
 * matching bucket wins, so keep the most specific patterns above the
 * looser catch-alls.
 */
const CP_BUCKETS: Array<{
    code: string;
    match: (fields: string[]) => boolean;
    retriable: boolean;
    userMessage: string;
    remediation: string;
    suggestedFields: string[];
}> = [
    {
        code: "CP_ADDRESS_UNVERIFIED",
        match: fs => hasAny(fs, ["address", "street", "city", "postal", "zip"]),
        retriable: true,
        userMessage: "Business address could not be verified against the registry.",
        remediation: "Check the street, city, state, and ZIP code exactly match your registered business.",
        suggestedFields: ["businessAddress", "city", "state", "postalCode"],
    },
    {
        code: "CP_LEGAL_NAME_MISMATCH",
        match: fs =>
            hasAny(fs, ["business name", "legal name", "registration number", "tax id", "ein"]),
        retriable: true,
        userMessage: "Legal business name or EIN doesn't match IRS records.",
        remediation: "Verify the legal name and EIN exactly as filed with the IRS.",
        suggestedFields: ["legalBusinessName", "ein"],
    },
    {
        code: "CP_AUTH_REP_UNVERIFIABLE",
        match: fs =>
            hasAny(fs, ["first name", "last name", "email", "phone", "authorized representative"]),
        retriable: true,
        userMessage: "Authorized representative details could not be verified.",
        remediation: "Confirm the representative's name, email, and phone number are current.",
        suggestedFields: [
            "contactFirstName",
            "contactLastName",
            "contactEmail",
            "contactPhone",
        ],
    },
    {
        code: "CP_BUSINESS_INFO_INCOMPLETE",
        match: fs => hasAny(fs, ["website", "industry", "classification", "business type"]),
        retriable: true,
        userMessage: "Business info is incomplete (website, industry, or classification).",
        remediation: "Fill in the business website and pick the correct industry / type.",
        suggestedFields: ["businessWebsite", "businessIndustry", "businessType"],
    },
];

export function classifyCustomerProfile(input: {
    customerProfile: CustomerProfileLike | null | undefined;
    latestEvaluation?: CpEvaluation | null;
}): Verdict {
    const status = input.customerProfile?.status ?? null;

    // Not rejected yet — surface nothing to fix.
    if (status !== "twilio-rejected") {
        return unrejected("customer_profile");
    }

    const failedFields = extractFailedFields(input.latestEvaluation);

    for (const bucket of CP_BUCKETS) {
        if (bucket.match(failedFields)) {
            return {
                stage: "customer_profile",
                retriable: bucket.retriable,
                code: bucket.code,
                userMessage: bucket.userMessage,
                remediation: bucket.remediation,
                suggestedFields: bucket.suggestedFields,
            };
        }
    }

    // Unknown reason — fail open. Surface the raw Twilio text so the user
    // has something to act on, and log for taxonomy expansion.
    const raw = failedFields.slice(0, 3).join(", ");
    return {
        stage: "customer_profile",
        retriable: true,
        code: null,
        userMessage: raw
            ? `Business Profile rejected — Twilio flagged: ${raw}.`
            : "Business Profile was rejected by Twilio.",
        remediation: "Review the flagged fields, correct them, and resubmit.",
        suggestedFields: [],
    };
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/**
 * TCR + Twilio failure codes we've catalogued. Matched by substring on
 * whatever Twilio returns in `failureReason` / `errorDetail` — TCR is not
 * consistent about capitalisation or wording, so we normalise to lowercase
 * before checking. Terminal codes lock the resubmit button entirely and
 * direct the user to support.
 */
const BRAND_RULES: Array<{
    code: string;
    match: (haystack: string) => boolean;
    retriable: boolean;
    userMessage: string;
    remediation: string;
    suggestedFields: string[];
}> = [
    // --- Terminal ---
    {
        code: "BRAND_PROHIBITED_ENTITY",
        match: h => /sanction|prohibited entity|ofac/.test(h),
        retriable: false,
        userMessage: "This entity is not permitted to register a 10DLC brand.",
        remediation: "Contact support — this rejection cannot be retried self-serve.",
        suggestedFields: [],
    },
    {
        code: "BRAND_PROHIBITED_INDUSTRY",
        match: h => /prohibited industry|industry not permitted|not eligible industry/.test(h),
        retriable: false,
        userMessage: "This industry is not permitted for 10DLC messaging.",
        remediation: "Contact support to review alternative outreach channels.",
        suggestedFields: [],
    },
    {
        code: "BRAND_GOVERNMENT_ONLY_ENTITY",
        match: h => /government (ein|entity|only)/.test(h),
        retriable: false,
        userMessage: "This EIN is registered as a government entity, which requires a different account type.",
        remediation: "Contact support to migrate to a government-eligible account.",
        suggestedFields: [],
    },
    {
        code: "BRAND_TRADEMARK_VIOLATION",
        match: h => /trademark|infring|impersonat/.test(h),
        retriable: false,
        userMessage: "Brand name flagged for possible trademark or impersonation issues.",
        remediation: "Contact support with proof of business ownership to appeal.",
        suggestedFields: [],
    },

    // --- Retriable ---
    {
        code: "BRAND_TAX_ID_MISMATCH",
        match: h => /(tax id|ein).*mismatch|legal name.*match|does not match irs/.test(h),
        retriable: true,
        userMessage: "Legal business name doesn't match IRS records for this EIN.",
        remediation: "Verify the legal name exactly matches your IRS filing, then resubmit.",
        suggestedFields: ["legalBusinessName", "ein"],
    },
    {
        code: "BRAND_TAX_ID_INVALID",
        match: h => /invalid (ein|tax id)|ein.*invalid|ein.*format/.test(h),
        retriable: true,
        userMessage: "EIN format or value is invalid.",
        remediation: "Re-enter your 9-digit EIN without dashes and resubmit.",
        suggestedFields: ["ein"],
    },
    {
        code: "BRAND_NONPROFIT_INVALID",
        match: h => /nonprofit.*(invalid|not verified|not found)/.test(h),
        retriable: true,
        userMessage: "Nonprofit status could not be verified.",
        remediation: "Confirm the 501(c) status and provide a matching legal name.",
        suggestedFields: ["legalBusinessName", "businessType"],
    },
    {
        code: "BRAND_WEBSITE_INVALID",
        match: h => /website (invalid|unreachable|missing|not found)/.test(h),
        retriable: true,
        userMessage: "Business website could not be verified.",
        remediation: "Provide a live, publicly reachable business website.",
        suggestedFields: ["businessWebsite"],
    },
    {
        code: "BRAND_LOW_BRAND_SCORE",
        match: h => /brand score|score too low|insufficient score/.test(h),
        retriable: true,
        userMessage: "Brand score was too low for approval.",
        remediation:
            "Improve business info (website, industry, address) and resubmit — TCR scoring often improves with a complete profile.",
        suggestedFields: ["businessWebsite", "businessIndustry"],
    },
];

export function classifyBrand(input: {
    brand: BrandRegistrationLike | null | undefined;
}): Verdict {
    const status = input.brand?.status ?? null;
    if (status !== "FAILED") {
        return unrejected("brand");
    }

    const rawDetail = [
        input.brand?.failureReason ?? "",
        input.brand?.errorDetail ?? "",
    ]
        .filter(Boolean)
        .join(" | ")
        .trim();
    const haystack = rawDetail.toLowerCase();

    for (const rule of BRAND_RULES) {
        if (rule.match(haystack)) {
            return {
                stage: "brand",
                retriable: rule.retriable,
                code: rule.code,
                userMessage: rule.userMessage,
                remediation: rule.remediation,
                suggestedFields: rule.suggestedFields,
            };
        }
    }

    return {
        stage: "brand",
        retriable: true,
        code: null,
        userMessage: rawDetail
            ? `Brand registration failed — TCR reason: ${rawDetail}.`
            : "Brand registration failed.",
        remediation: "Review your business info and resubmit. A TCR resubmission fee applies.",
        suggestedFields: [],
    };
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

const CAMPAIGN_RULES: Array<{
    code: string;
    match: (haystack: string) => boolean;
    retriable: boolean;
    userMessage: string;
    remediation: string;
    suggestedFields: string[];
}> = [
    // --- Terminal ---
    {
        code: "CAMPAIGN_USE_CASE_PROHIBITED",
        match: h =>
            /use case not permitted|prohibited use case|banned use case|not allowed by (carrier|carriers)/.test(h),
        retriable: false,
        userMessage: "This use case is not permitted by carriers.",
        remediation: "Choose a different use case, or contact support to discuss options.",
        suggestedFields: ["useCase"],
    },

    // --- Retriable ---
    {
        code: "CAMPAIGN_MISSING_OPT_IN",
        match: h => /opt-?in|consent language|missing consent/.test(h),
        retriable: true,
        userMessage: "Sample messages must include clear opt-in language.",
        remediation: "Add opt-in confirmation (e.g., \"Reply YES to confirm\") to at least one sample.",
        suggestedFields: ["messageSamples", "optInDetails", "optInKeywords"],
    },
    {
        code: "CAMPAIGN_MISSING_OPT_OUT",
        match: h => /opt-?out|stop instructions|missing stop/.test(h),
        retriable: true,
        userMessage: "Sample messages must include opt-out instructions.",
        remediation: "Add \"Reply STOP to unsubscribe\" (or equivalent) to your samples.",
        suggestedFields: ["messageSamples", "optOutKeywords"],
    },
    {
        code: "CAMPAIGN_PROHIBITED_CONTENT",
        match: h =>
            /prohibited content|shaft|hate|violence|adult content|illicit content/.test(h),
        retriable: true,
        userMessage: "Sample messages contain content prohibited by carriers.",
        remediation: "Remove prohibited content (SHAFT categories) from your samples and resubmit.",
        suggestedFields: ["messageSamples"],
    },
    {
        code: "CAMPAIGN_SAMPLES_MISMATCH_USE_CASE",
        match: h =>
            /(sample|content) (does )?not match use case|content mismatch|use case mismatch/.test(h),
        retriable: true,
        userMessage: "Sample messages don't match the declared use case.",
        remediation: "Revise samples so they represent the use case you selected.",
        suggestedFields: ["messageSamples", "useCase"],
    },
    {
        code: "CAMPAIGN_HELP_MESSAGE_MISSING",
        match: h => /help (message|keyword) (missing|invalid|required)/.test(h),
        retriable: true,
        userMessage: "HELP response message is missing or invalid.",
        remediation: "Provide a HELP response describing how recipients can get support.",
        suggestedFields: ["helpMessage", "helpKeywords"],
    },
];

export function classifyCampaign(input: {
    campaign: CampaignLike | null | undefined;
}): Verdict {
    const status = input.campaign?.campaignStatus ?? null;
    if (status !== "FAILED") {
        return unrejected("campaign");
    }

    const rawDetail = (input.campaign?.rejectionReason ?? "").trim();
    const haystack = rawDetail.toLowerCase();

    for (const rule of CAMPAIGN_RULES) {
        if (rule.match(haystack)) {
            return {
                stage: "campaign",
                retriable: rule.retriable,
                code: rule.code,
                userMessage: rule.userMessage,
                remediation: rule.remediation,
                suggestedFields: rule.suggestedFields,
            };
        }
    }

    return {
        stage: "campaign",
        retriable: true,
        code: null,
        userMessage: rawDetail
            ? `Campaign rejected — TCR reason: ${rawDetail}.`
            : "Campaign was rejected by TCR.",
        remediation: "Review your samples and opt-in/opt-out language, then resubmit.",
        suggestedFields: ["messageSamples"],
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unrejected(stage: A2PStage): Verdict {
    return {
        stage,
        retriable: null,
        code: null,
        userMessage: "",
        remediation: "",
        suggestedFields: [],
    };
}

function extractFailedFields(evaluation: CpEvaluation | null | undefined): string[] {
    if (!evaluation?.results) return [];
    const out: string[] = [];
    for (const r of evaluation.results) {
        for (const f of r.fields ?? []) {
            if (f.passed === false) {
                out.push((f.friendly_name || f.object_field || "").toString());
            }
        }
    }
    return out.filter(Boolean);
}

function hasAny(fields: string[], keywords: string[]): boolean {
    const lower = fields.map(f => f.toLowerCase());
    return keywords.some(kw => lower.some(f => f.includes(kw)));
}
