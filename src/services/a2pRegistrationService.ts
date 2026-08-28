import prisma from "../lib/prisma";
import { encryptEIN } from "../utils/encryption";
import twilio from "twilio";
import { envConfig, client as masterClient } from "../lib/config";

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
}

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

        // 2. Initialize DB record
        const registration = await prisma.a2P_Registration.upsert({
            where: { userId },
            create: {
                userId,
                ...details,
                ein: encryptedEin,
                status: "PENDING",
            },
            update: {
                ...details,
                ein: encryptedEin,
                status: "PENDING",
                rejectionReason: null,
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
                    business_industry: 'REAL_ESTATE',
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
     */
    private async executePhase2(userId: string, registration: any, subClient: any) {
        console.log(`[A2P Service] Starting Phase 2 for user: ${userId}`);
        
        try {
            // STEP 3: Create Messaging Service
            console.log("[A2P Service] Step 3: Creating Messaging Service...");
            const messagingService = await subClient.messaging.v1.services.create({
                friendlyName: `${registration.legalBusinessName} Messaging Service`,
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // STEP 4: Submit Campaign
            console.log("[A2P Service] Step 4: Submitting Campaign...");
            const campaign = await subClient.messaging.v1
                .services(messagingService.sid)
                .usAppToPerson.create({
                    brandRegistrationSid: registration.brandSid,
                    description: 'Sending appointment reminders, follow-ups, and lead outreach messages to real estate contacts who have opted in.',
                    messageSamples: [
                        'Hi {name}, this is {agent} following up on the property at {address}. Reply STOP to opt out.',
                        'Your showing appointment is confirmed for {date} at {time}. Reply STOP to opt out.',
                        'Hi {name}, I wanted to check in regarding your real estate inquiry. Reply STOP to opt out.'
                    ],
                    usAppToPersonUsecase: getUsAppToPersonUsecase(registration.businessType),
                    messageFlow: 'Contacts opt-in via lead forms on our website and verbal consent during initial contact.',
                    hasEmbeddedLinks: false,
                    hasEmbeddedPhone: false,
                    optInMessage: 'You have opted in to receive messages from {agent}. Reply STOP to unsubscribe.',
                    optOutMessage: 'You have been unsubscribed. Reply START to resubscribe.',
                    helpMessage: 'For help contact support@slingvo.com. Reply STOP to unsubscribe.',
                    subscriberOptIn: true,
                    subscriberOptOut: true,
                    subscriberHelp: true
                } as any);

            // Update DB with Phase 2 SIDs
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    messagingServiceSid: messagingService.sid,
                    campaignSid: campaign.sid,
                    status: "PENDING" // Still pending final campaign approval
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
     * A2P has two independent Twilio resources that can be rejected:
     *   - Customer Profile (Business Profile, BU… SID) — vetted by Twilio itself.
     *   - Brand Registration (BN… SID) — vetted against TCR by the carriers.
     *
     * Either rejection means the local status should flip to REJECTED so the
     * UI stops showing "under review" indefinitely. We check the customer
     * profile first because it's the upstream artifact (a rejected profile
     * makes brand progression moot).
     */
    async checkA2PStatus(userId: string) {
        const reg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!reg) return "NOT_STARTED";
        // APPROVED is truly terminal — skip the network round-trip.
        // REJECTED is NOT — we want to keep the rejection message fresh so
        // improvements to the summarizer, or updates to Twilio's evaluation
        // results, actually surface on the next status fetch.
        if (reg.status === "APPROVED") return "APPROVED";

        const integration = await prisma.integration.findFirst({
            where: { systemSetting: { userId }, provider: "TWILIO" }
        });
        if (!integration?.credentials) return reg.status;

        const creds = integration.credentials as any;
        const subClient = twilio(creds.accountSid, creds.authToken);

        try {
            // 1) Check Customer Profile — the Business Profile that everything
            //    else attaches to. A twilio-rejected profile is terminal for
            //    this whole A2P attempt.
            if (reg.customerProfileSid) {
                const profile = await subClient.trusthub.v1
                    .customerProfiles(reg.customerProfileSid)
                    .fetch();
                console.log(`[A2P Service] Customer Profile ${reg.customerProfileSid} status: ${profile.status}`);

                // Mirror the profile-only approval state onto the local row.
                // Voice Integrity and CNAM key off this — they need the
                // Customer Profile approved, but don't care about Brand /
                // Campaign, which often get rejected by TCR for legitimate
                // real-estate / lead-gen use cases.
                if (profile.status === "twilio-approved" && !reg.customerProfileApproved) {
                    await prisma.a2P_Registration.update({
                        where: { userId },
                        data: { customerProfileApproved: true },
                    });
                }

                if (profile.status === "twilio-rejected") {
                    let detail = "Business Profile was rejected by Twilio.";
                    try {
                        const evals = await subClient.trusthub.v1
                            .customerProfiles(reg.customerProfileSid)
                            .customerProfilesEvaluations.list({ limit: 3 });
                        const latest = evals.find(e => e.status === "noncompliant") || evals[0];
                        if (latest && (latest as any).results) {
                            const failedFields = (latest as any).results
                                .flatMap((r: any) => r.fields || [])
                                .filter((f: any) => f.passed === false)
                                .map((f: any) => (f.friendly_name || f.object_field || "").toString());
                            const summary = summarizeRejectionFields(failedFields);
                            if (summary) detail = summary;
                        }
                    } catch { /* best-effort */ }

                    await prisma.a2P_Registration.update({
                        where: { userId },
                        data: { status: "REJECTED", rejectionReason: detail },
                    });
                    return "REJECTED";
                }

                // The CP is in an unrejected state (draft / pending-review /
                // in-review / twilio-approved). If the local row still carries
                // a stale REJECTED status + "Business Profile was rejected..."
                // reason from an earlier failed attempt, clear it. Otherwise
                // the UI keeps showing a rejection for a CP Twilio is happily
                // reviewing. Only clear when the current message specifically
                // came from the CP rejection branch — leave Brand/Phase 2
                // rejection reasons intact, since those live independently.
                if (
                    reg.status === "REJECTED" &&
                    reg.rejectionReason &&
                    /business profile/i.test(reg.rejectionReason)
                ) {
                    await prisma.a2P_Registration.update({
                        where: { userId },
                        data: { status: "PENDING", rejectionReason: null },
                    });
                }
            }

            // 2) Check Brand — only relevant if the profile isn't rejected and a
            //    brand has been submitted. Brand approval triggers Phase 2
            //    (Messaging Service + Campaign creation).
            if (reg.brandSid && reg.status === "PENDING" && !reg.campaignSid) {
                console.log(`[A2P Service] Checking brand status for user: ${userId}`);
                const brand = await subClient.messaging.v1.brandRegistrations(reg.brandSid).fetch();
                console.log(`[A2P Service] Brand status: ${brand.status}`);

                if (brand.status === "APPROVED") {
                    await this.executePhase2(userId, reg, subClient);
                } else if (brand.status === "FAILED") {
                    const detail = (brand as any).failureReason || (brand as any).errorDetail || "Brand registration failed";
                    await prisma.a2P_Registration.update({
                        where: { userId },
                        data: { status: "REJECTED", rejectionReason: `Brand rejected: ${detail}` },
                    });
                    return "REJECTED";
                }
            }
        } catch (error: any) {
            console.error("[A2P Service] Status check error:", error.message);
        }

        const updatedReg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        return updatedReg?.status || "PENDING";
    }
}

export const a2pRegistrationService = new A2PRegistrationService();
