import { Request, Response } from "express";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount, purchaseUSPhoneNumber } from "../../services/twilio-account.service";
import { envConfig } from "../../lib/config";
import { triggerZapierWebhook } from "../../lib/zapier";

function getStripeClient() {
  const key = envConfig.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

// Important: Webhooks need raw body for signature verification. 
// Assuming `express.raw({type: 'application/json'})` is handled at the router level for this route.
export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = envConfig.STRIPE_WEBHOOK_SECRET || "";

  let stripe: any;

  try {
    stripe = getStripeClient();
  } catch {
    res.status(500).send("Stripe is not configured on this server.");
    return;
  }

  // Use any to avoid 'StripeConstructor has no exported member Event' TS error
  let event: any;

  try {
    // Requires req.body to be raw buffer.
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Signature verification failed:`, err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle successful checkout
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    const metadata = session.metadata;

    if (metadata && metadata.email) {
      const { fullName, email, hashedPassword, companyName } = metadata;

      let newUser: any = null;
      try {
        console.log(`[Stripe Webhook] Processing new signup for ${email}`);
        
        // 0. Check for existing user (Idempotency)
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            console.log(`[Stripe Webhook] User ${email} already exists, skipping provisioning.`);
            res.json({ received: true });
            return;
        }

        // 1. Create the User in DB
        newUser = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            fullName,
            role: "ADMIN",
            status: "ACTIVE",
            trialStatus: "ACTIVE",
            isSubscribed: false,
            emailVerified: true,
          },
        });

        // 1.5 Create Better Auth Account record
        await prisma.account.create({
            data: {
                userId: newUser.id,
                accountId: newUser.id,
                providerId: "credential",
                password: hashedPassword,
            }
        });

        // 2. Create the Company
        let company;
        if (companyName) {
            company = await prisma.company.create({
                data: {
                    companyName: companyName,
                    userId: newUser.id
                }
            });
        }

        // 3. Create the Base System Setting
        const systemSetting = await prisma.system_Setting.create({
          data: {
            userId: newUser.id,
          },
        });

        // 4. Provision Twilio Subaccount (STRICT: No internal try/catch)
        const subAccount = await createTwilioSubAccount(fullName || email);
        
        await prisma.integration.create({
            data: {
                systemSettingId: systemSetting.id,
                provider: "TWILIO",
                status: "CONNECTED",
                credentials: {
                    accountSid: subAccount.sid,
                    authToken: subAccount.authToken,
                    apiKeySid: subAccount.apiKeySid,
                    apiKeySecret: subAccount.apiKeySecret
                }
            }
        });

        // 4.5 Buy a US Phone Number (STRICT: No internal try/catch)
        // TODO: Uncomment in production — auto-purchases 
        // a phone number for the user's sub-account
        console.log(`[Stripe Webhook] Skipping primary US number purchase for ${email} (Provisioning Disabled)`);
       
        const purchased = await purchaseUSPhoneNumber(subAccount.sid, subAccount.authToken);
        
        await prisma.callerId.create({
            data: {
                label: `Primary Line (${purchased.phoneNumber})`,
                countryCode: "US",
                twillioNumber: purchased.phoneNumber,
                twillioSid: purchased.sid,
                systemSettingId: systemSetting.id,
                numberOfLines: 1
            }
        });
        

        // 5. Setup basic Library and folders
        await prisma.library.create({
            data: {
                userId: newUser.id
            }
        });

        await prisma.contactFolder.create({
            data: {
                name: "General Leads",
                isSystem: true,
                userId: newUser.id
            }
        });

        console.log(`[Stripe Webhook] Full provisioning successful for ${email}`);

        // Fire Zapier Webhook
        console.log("[Zapier] About to fire webhook for:", email);
        triggerZapierWebhook({
          event: "NEW_USER_SIGNUP",
          timestamp: new Date().toISOString(),
          user: {
            id: newUser.id,
            fullName: newUser.fullName,
            email: newUser.email,
            role: newUser.role,
            createdAt: newUser.createdAt,
          },
        });

      } catch (error: any) {
        console.error(`[Stripe Webhook] Provisioning FAILED for ${email}. Rolling back...`, error.message);
        
        // ROLLBACK: Delete the user if it was created. 
        // Thanks to Cascade deletes in Prisma, this will remove Company, Account, Integrations, etc.
        if (newUser?.id) {
            try {
                await prisma.user.delete({ where: { id: newUser.id } });
                console.log(`[Stripe Webhook] Rollback successful. Deleted user ${email}`);
            } catch (cleanupError) {
                console.error(`[Stripe Webhook] Rollback cleanup failed:`, cleanupError);
            }
        }
        
        // Return 500 so Stripe knows to retry later
        res.status(500).send(`Provisioning failed: ${error.message}`);
        return;
      }
    }
  }

  res.json({ received: true });
};
