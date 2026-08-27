import prisma from "../lib/prisma";
import { encryptEIN } from "../utils/encryption";
import twilio from "twilio";
import { envConfig } from "../lib/config";

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

export class A2PRegistrationService {
    /**
     * Executes the 4-step A2P registration sequence.
     */
    async submitA2PRegistration(userId: string, details: A2PBusinessDetails) {
        console.log(`[A2P Service] Starting registration for user: ${userId}`);

        // 1. Encrypt EIN before saving to DB
        const encryptedEin = encryptEIN(details.ein);

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

        try {
            // STEP 1: Create Customer Profile (Trust Hub)
            console.log("[A2P Service] Step 1: Creating Customer Profile...");
            const policies = await subClient.trusthub.v1.policies.list();
            const businessPolicy = policies.find(p => 
                p.friendlyName.toLowerCase().includes('business')
            );
            const policySid = businessPolicy?.sid;

            if (!policySid) throw new Error("Could not find business policy SID");

            const profile = await subClient.trusthub.v1.customerProfiles.create({
                friendlyName: details.legalBusinessName,
                email: details.contactEmail,
                phoneNumber: details.contactPhone,
                policySid: policySid,
                statusCallbackUrl: `${envConfig.BACKEND_URL}/api/a2p/webhook`
            } as any);

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
            const businessInfo = await subClient.trusthub.v1.endUsers.create({
                friendlyName: `${details.legalBusinessName} - Business Info`,
                type: 'customer_profile_business_information',
                attributes: {
                    business_name: details.legalBusinessName,
                    business_registration_number: details.ein,
                    business_registration_identifier: 'EIN',
                    business_type: details.businessType,
                    // Real-estate is the client's primary vertical; adjust
                    // via the A2P form once we surface it as a picker.
                    business_industry: 'REAL_ESTATE',
                    business_regions_of_operation: 'USA_AND_CANADA',
                    website_url: details.businessWebsite,
                },
            });

            // STEP 1c: End User — authorized_representative_1.
            console.log("[A2P Service] Step 1c: Creating authorized_representative_1 End User...");
            const authRep = await subClient.trusthub.v1.endUsers.create({
                friendlyName: `${details.contactFirstName} ${details.contactLastName} - Auth Rep`,
                type: 'authorized_representative_1',
                attributes: {
                    job_position: 'Director',
                    phone_number: details.contactPhone,
                    business_title: 'Director',
                    first_name: details.contactFirstName,
                    last_name: details.contactLastName,
                    email: details.contactEmail,
                },
            });

            // STEP 1d: Attach the three artifacts to the Customer Profile.
            console.log("[A2P Service] Step 1d: Attaching entities to Customer Profile...");
            const attach = (objectSid: string) =>
                subClient.trusthub.v1
                    .customerProfiles(profile.sid)
                    .customerProfilesEntityAssignments.create({ objectSid });
            await attach(addressDoc.sid);
            await attach(businessInfo.sid);
            await attach(authRep.sid);

            // STEP 1e: Submit the Customer Profile for Twilio review. Until
            //          this transitions to twilio-approved, VI + CNAM stay
            //          locked. Brand can be created before this resolves,
            //          but Brand vetting also depends on the profile being
            //          approved, so it usually fails until then.
            console.log("[A2P Service] Step 1e: Submitting Customer Profile for review...");
            await subClient.trusthub.v1
                .customerProfiles(profile.sid)
                .update({ status: 'pending-review' });

            await new Promise(resolve => setTimeout(resolve, 500));

            // STEP 2: Register Brand
            console.log("[A2P Service] Step 2: Registering Brand...");
            const brand = await subClient.messaging.v1.brandRegistrations.create({
                customerProfileBundleSid: profile.sid,
                a2PProfileBundleSid: profile.sid,
                brandType: getBrandType(details.businessType)
            });

            // Update DB with Phase 1 SIDs
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    customerProfileSid: profile.sid,
                    brandSid: brand.sid,
                    status: "PENDING"
                }
            });

            return { status: "PENDING" };

        } catch (error: any) {
            console.error("[A2P Service] Registration FAILED:", error.message, error.code, error.status);
            // On failure: Reset status and clear all SIDs
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    status: "NOT_STARTED",
                    customerProfileSid: null,
                    brandSid: null,
                    messagingServiceSid: null,
                    campaignSid: null,
                    rejectionReason: error.message
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
