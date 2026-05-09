import twilio from "twilio";
import { client as masterClient } from "../lib/config";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";

/**
 * Creates a Twilio Sub-Account for a user.
 * @param friendlyName The name of the sub-account (e.g. User's full name)
 * @returns The sub-account details (Sid and AuthToken)
 */
export async function createTwilioSubAccount(friendlyName: string) {
    try {
        console.log(`[TwilioService] Creating sub-account for: ${friendlyName}`);
        
        const account = await masterClient.api.accounts.create({
            friendlyName: friendlyName
        });

        console.log(`[TwilioService] Sub-account created: ${account.sid}`);
        
        return {
            sid: account.sid,
            authToken: account.authToken,
            status: account.status
        };
    } catch (error: any) {
        console.error(`[TwilioService] Error creating sub-account:`, error.message);
        throw new Error(`Twilio sub-account creation failed: ${error.message}`);
    }
}

/**
 * Returns a Twilio client initialized with the user's specific sub-account credentials.
 * If no sub-account is found, it falls back to the master account client.
 * @param userId The ID of the user requesting the client
 */
export async function getTwilioClient(userId: string) {
    try {
        // 1. Fetch user to check role and parent
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, createdById: true }
        });

        if (!user) return masterClient;

        // 2. Identify the effective "Owner" (ADMIN) who holds the Twilio integration
        let effectiveUserId = userId;
        if (user.role === "AGENT" && user.createdById) {
            effectiveUserId = user.createdById;
        }

        // 3. Look up Twilio integration for this user
        const integration = await prisma.integration.findFirst({
            where: {
                provider: "TWILIO",
                systemSetting: {
                    userId: effectiveUserId
                }
            }
        });

        if (integration && integration.credentials) {
            const creds = integration.credentials as any;
            if (creds.accountSid && creds.authToken) {
                console.log(`[TwilioService] Using sub-account client for user ${userId} (Sub-SID: ${creds.accountSid})`);
                return twilio(creds.accountSid, creds.authToken);
            }
        }

        console.log(`[TwilioService] No sub-account found for user ${userId}, using master client.`);
        return masterClient;
    } catch (error) {
        console.error(`[TwilioService] Error fetching sub-account client:`, error);
        return masterClient;
    }
}

/**
 * Automatically finds and purchases a US phone number for a sub-account.
 * @param subAccountSid The SID of the sub-account
 * @param subAccountAuthToken The Auth Token of the sub-account
 */
export async function purchaseUSPhoneNumber(subAccountSid: string, subAccountAuthToken: string) {
    try {
        const subClient = twilio(subAccountSid, subAccountAuthToken);
        
        console.log(`[TwilioService] Searching for available US numbers for sub-account: ${subAccountSid}`);
        
        // 1. Find an available local US number
        const availableNumbers = await subClient.availablePhoneNumbers('US').local.list({
            limit: 1,
            voiceEnabled: true,
            smsEnabled: true
        });

        if (availableNumbers.length === 0) {
            throw new Error("No available US phone numbers found.");
        }

        const selectedNumber = availableNumbers[0].phoneNumber;
        console.log(`[TwilioService] Found available number: ${selectedNumber}. Purchasing...`);

        // 2. Purchase the number
        const purchasedNumber = await subClient.incomingPhoneNumbers.create({
            phoneNumber: selectedNumber,
            voiceUrl: `${envConfig.BACKEND_URL}/api/calling/webhooks/voice`,
            voiceMethod: "POST",
            statusCallback: `${envConfig.BACKEND_URL}/api/calling/webhooks/call-status`,
            statusCallbackMethod: "POST"
        });

        console.log(`[TwilioService] Successfully purchased number: ${purchasedNumber.phoneNumber} (SID: ${purchasedNumber.sid})`);
        
        return {
            phoneNumber: purchasedNumber.phoneNumber,
            sid: purchasedNumber.sid
        };
    } catch (error: any) {
        console.error(`[TwilioService] Error purchasing phone number:`, error.message);
        throw new Error(`Phone number purchase failed: ${error.message}`);
    }
}
