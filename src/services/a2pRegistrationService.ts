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

            await new Promise(resolve => setTimeout(resolve, 1000));

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
     * Polls Twilio for status updates and triggers Phase 2 when Brand is approved.
     */
    async checkA2PStatus(userId: string) {
        const reg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!reg || !reg.brandSid) return reg?.status || "NOT_STARTED";

        // If Phase 2 hasn't run yet, check brand status to trigger it
        if (reg.status === "PENDING" && !reg.campaignSid) {
            try {
                const integration = await prisma.integration.findFirst({
                    where: { 
                        systemSetting: { userId },
                        provider: "TWILIO"
                    }
                });

                if (integration && integration.credentials) {
                    const creds = integration.credentials as any;
                    const subClient = twilio(creds.accountSid, creds.authToken);

                    console.log(`[A2P Service] Checking brand status for user: ${userId}`);
                    const brand = await subClient.messaging.v1.brandRegistrations(reg.brandSid).fetch();
                    
                    console.log(`[A2P Service] Brand status: ${brand.status}`);

                    if (brand.status === "APPROVED") {
                        await this.executePhase2(userId, reg, subClient);
                    } else if (brand.status === "FAILED") {
                        await prisma.a2P_Registration.update({
                            where: { userId },
                            data: {
                                status: "REJECTED",
                                rejectionReason: `Twilio Brand Rejection: ${brand.status}`
                            }
                        });
                    }
                }
            } catch (error: any) {
                console.error("[A2P Service] Status check error:", error.message);
            }
        }

        // Return current DB status
        const updatedReg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        return updatedReg?.status || "PENDING";
    }
}

export const a2pRegistrationService = new A2PRegistrationService();
