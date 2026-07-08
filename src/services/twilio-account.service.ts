import twilio from "twilio";
import { client as masterClient } from "../lib/config";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";
import { removeAddonSubscriptionItem, cancelAddonSubscriptionForUser } from "./phoneNumberBilling.service";

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

        console.log(`[TwilioService] Sub-account created: ${account.sid}. Creating API Key...`);
        
        // Create a real API Key for this sub-account (required for Voice SDK Access Tokens)
        const subClient = twilio(account.sid, account.authToken);
        const newKey = await subClient.newKeys.create({ friendlyName: 'MultiDialer Key' });

        return {
            sid: account.sid,
            authToken: account.authToken,
            status: account.status,
            apiKeySid: newKey.sid,
            apiKeySecret: newKey.secret
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
 * Returns the Twilio sub-account SID that owns the given user's numbers
 * (resolving AGENT → parent ADMIN, same rule as getTwilioClient), or null if
 * the user has no Twilio integration configured yet.
 */
export async function getUserTwilioSubAccountSid(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, createdById: true },
    });
    if (!user) return null;

    const effectiveUserId = user.role === "AGENT" && user.createdById ? user.createdById : userId;

    const integration = await prisma.integration.findFirst({
        where: {
            provider: "TWILIO",
            systemSetting: { userId: effectiveUserId },
        },
    });

    const creds = integration?.credentials as any;
    return creds?.accountSid || null;
}

/**
 * Transfers ownership of a phone number (bought on the master account) into a
 * user's Twilio sub-account, using Twilio's "Exchanging Numbers Between
 * Subaccounts" mechanism — an update call authenticated as the CURRENT owner
 * (master), specifying the target sub-account's SID.
 */
export async function transferNumberToSubAccount(twilioSid: string, subAccountSid: string) {
    await masterClient.incomingPhoneNumbers(twilioSid).update({ accountSid: subAccountSid });
}

/**
 * Releases (relinquishes) a phone number back to Twilio. Pass the client that
 * currently owns the number — the master client if the purchase/charge failed
 * before transfer, or the user's own sub-account client if it was already
 * transferred to them.
 */
export async function releaseNumber(twilioSid: string, ownerClient: ReturnType<typeof twilio> = masterClient) {
    try {
        await ownerClient.incomingPhoneNumbers(twilioSid).remove();
    } catch (error: any) {
        console.error(`[TwilioService] Failed to release number ${twilioSid}:`, error.message);
        throw error;
    }
}

/**
 * Permanently closes a Twilio sub-account. Twilio does not allow closed
 * accounts to be reopened, so this must only be called when the owning
 * user's account is being permanently deleted. Must be issued from the
 * PARENT (master) account — a sub-account cannot close itself.
 */
export async function closeTwilioSubAccount(subAccountSid: string) {
    try {
        await masterClient.api.v2010.accounts(subAccountSid).update({ status: "closed" });
        console.log(`[TwilioService] Closed sub-account: ${subAccountSid}`);
    } catch (error: any) {
        console.error(`[TwilioService] Failed to close sub-account ${subAccountSid}:`, error.message);
        throw error;
    }
}

/**
 * Full Twilio teardown for a user whose account is being permanently
 * deleted: releases every phone number they own (plan-included AND paid
 * add-on), stops billing for any add-on numbers, cancels their dedicated
 * add-on subscription, and finally closes their Twilio sub-account itself.
 * Only meaningful for ADMIN accounts — agents don't own a sub-account or
 * numbers of their own (they use their admin's), so callers should not
 * invoke this for AGENT/OWNER users.
 */
export async function releaseTwilioResourcesForUser(userId: string): Promise<void> {
    const callerIds = await prisma.callerId.findMany({
        where: { systemSetting: { userId } },
        select: { id: true, twillioSid: true, billingSource: true, stripeSubscriptionItemId: true },
    });

    if (callerIds.length > 0) {
        const ownerClient = await getTwilioClient(userId);
        for (const c of callerIds) {
            if (c.twillioSid) {
                await releaseNumber(c.twillioSid, ownerClient).catch((err: any) =>
                    console.error(`[UserDeletion] Failed to release number ${c.twillioSid} for user ${userId}:`, err.message)
                );
            }
            if (c.billingSource === "PAID_ADDON" && c.stripeSubscriptionItemId) {
                await removeAddonSubscriptionItem(c.stripeSubscriptionItemId);
            }
        }
    }

    // Cancel their dedicated add-on subscription, if any (safe no-op otherwise).
    await cancelAddonSubscriptionForUser(userId);

    // Close the sub-account itself so it stops existing on Twilio entirely.
    const subAccountSid = await getUserTwilioSubAccountSid(userId);
    if (subAccountSid) {
        await closeTwilioSubAccount(subAccountSid).catch((err: any) =>
            console.error(`[UserDeletion] Failed to close Twilio sub-account ${subAccountSid} for user ${userId}:`, err.message)
        );
    }
}

export { masterClient };

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
