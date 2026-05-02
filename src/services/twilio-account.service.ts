import { client } from "../lib/config";

/**
 * Creates a Twilio Sub-Account for a user.
 * @param friendlyName The name of the sub-account (e.g. User's full name)
 * @returns The sub-account details (Sid and AuthToken)
 */
export async function createTwilioSubAccount(friendlyName: string) {
    try {
        console.log(`[TwilioService] Creating sub-account for: ${friendlyName}`);
        
        const account = await client.api.accounts.create({
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
