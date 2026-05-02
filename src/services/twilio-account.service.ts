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
