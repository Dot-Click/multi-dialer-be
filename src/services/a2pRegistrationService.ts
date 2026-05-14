import prisma from "../lib/prisma";
import { encryptEIN } from "../utils/encryption";
import twilio from "twilio";

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
            // Note: Real registration involves address/entity verification. 
            // We use the sub-account client as requested.
            const profile = await subClient.trusthub.v1.customerProfiles.create({
                friendlyName: details.legalBusinessName,
                email: details.contactEmail,
                policySid: 'RNdf1861150ec6070624a905a5a1f6a19f' // Standard A2P Policy
            });

            // STEP 2: Register Brand
            console.log("[A2P Service] Step 2: Registering Brand...");
            const brand = await subClient.messaging.v1.brandRegistrations.create({
                customerProfileBundleSid: profile.sid,
                a2PProfileBundleSid: profile.sid,
                brandType: details.businessType === 'SOLE_PROPRIETOR' ? 'SOLE_PROPRIETOR' : 'STANDARD'
            });

            // STEP 3: Create Messaging Service
            console.log("[A2P Service] Step 3: Creating Messaging Service...");
            const messagingService = await subClient.messaging.v1.services.create({
                friendlyName: `${details.legalBusinessName} Messaging Service`,
            });

            // STEP 4: Submit Campaign
            console.log("[A2P Service] Step 4: Submitting Campaign...");
            const campaign = await subClient.messaging.v1.services(messagingService.sid).usAppToPerson.create({
                brandRegistrationSid: brand.sid,
                description: 'Marketing and customer support messages.',
                messageSamples: ['Hello, this is a test message.'],
                usAppToPersonUsecase: 'LOW_VOLUME_MIXED',
                messageFlow: 'Users opt-in via a checkbox on our website signup form.',
                hasEmbeddedLinks: false,
                hasEmbeddedPhone: false
            });

            // Update DB with REAL SIDs
            await prisma.a2P_Registration.update({
                where: { userId },
                data: {
                    customerProfileSid: profile.sid,
                    brandSid: brand.sid,
                    messagingServiceSid: messagingService.sid,
                    campaignSid: campaign.sid,
                }
            });

            return { status: "PENDING" };

        } catch (error: any) {
            console.error("[A2P Service] Registration FAILED:", error.message);
            await prisma.a2P_Registration.update({
                where: { userId },
                data: { 
                    status: "REJECTED",
                    rejectionReason: `Internal Error: ${error.message}`
                }
            });
            throw error;
        }
    }

    /**
     * Polls Twilio for status updates.
     */
    async checkA2PStatus(userId: string) {
        const reg = await prisma.a2P_Registration.findUnique({ where: { userId } });
        if (!reg || !reg.brandSid) return reg?.status || "NOT_STARTED";

        // In real app, call Twilio to check status of reg.brandSid and reg.campaignSid
        // For now, return DB status
        return reg.status;
    }
}

export const a2pRegistrationService = new A2PRegistrationService();
