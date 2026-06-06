import { Request, Response } from "express";
import crypto from "crypto";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount, purchaseUSPhoneNumber } from "../../services/twilio-account.service";
import { envConfig } from "../../lib/config";
import { triggerZapierWebhook } from "../../lib/zapier";
import { createMyPlusLeadsAccount, disableMyPlusLeadsAccount, syncLeadsForUser } from "../../services/myPlusLeads.service";
import { encryptEIN as encrypt } from "../../utils/encryption";

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

        const subEmail = `slingvo+${newUser.id}@slingvo.com`;
        const subPassword = crypto.randomBytes(12).toString("hex");
        const nameParts = (newUser.fullName?.trim().split(/\s+/).filter(Boolean)) ?? ["User"];
        const firstName = nameParts[0] || "User";
        const lastName = nameParts.slice(1).join(" ") || "User";

        try {
          const defaultBaseZip = envConfig.MYPLUSLEADS_DEFAULT_BASE_ZIP;
          const { accountId } = await createMyPlusLeadsAccount({
            email: subEmail,
            password: subPassword,
            firstName,
            lastName,
            phone: "0000000000",
            address: "123 Main St",
            city: "Austin",
            state: "TX",
            zip: defaultBaseZip || "7870",
            baseZip: defaultBaseZip || "7870",
          });

          await prisma.myPlusLeadsConfig.create({
            data: {
              userId: newUser.id,
              subAccountEmail: subEmail,
              subAccountPassword: encrypt(subPassword),
              subAccountId: String(accountId),
              status: "CONNECTED",
              errorMessage: null,
            },
          });

          // Kick off initial lead pull in the background so the webhook can
          // respond fast. Errors are caught and logged — they won't block signup.
          syncLeadsForUser(newUser.id)
            .then((result) => {
              console.log(`[MyPlusLeads] Initial sync for ${email}: imported ${result.imported}, skipped ${result.skipped}`);
            })
            .catch((err) => {
              console.error(`[MyPlusLeads] Initial sync failed for ${email}:`, err?.message ?? err);
            });

        } catch (err) {
          console.error("[Stripe Webhook] MyPlusLeads account creation failed:", err);
          await prisma.myPlusLeadsConfig.create({
            data: {
              userId: newUser.id,
              status: "FAILED",
              errorMessage: err instanceof Error ? err.message : String(err),
            },
          });
        }

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
  } else if (event.type === "customer.subscription.updated") {
    try {
      const subscription = event.data.object as any;
      const stripeCustomerId = subscription.customer;
      const status = subscription.status;
      const priceId = subscription.items.data[0].price.id;

      console.log(`[Stripe Webhook] customer.subscription.updated: customer=${stripeCustomerId}, status=${status}, priceId=${priceId}`);

      const subRecord = await prisma.userSubscription.findFirst({
        where: { stripeCustomerId },
      });

      if (subRecord) {
        // Map priceId to our Plan enum
        let mappedPlan: any = "STARTER";
        if (priceId === process.env.STRIPE_PRICE_STANDARD) {
          mappedPlan = "PROFESSIONAL";
        } else if (priceId === process.env.STRIPE_PRICE_PREMIUM) {
          mappedPlan = "ENTERPRISE";
        }

        // Update userSubscription
        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: {
            plan: mappedPlan,
            status: status as any,
          },
        });

        // Update User model
        await prisma.user.update({
          where: { id: subRecord.userId },
          data: {
            isSubscribed: status === "active",
          },
        });

        console.log(`[Stripe Webhook] customer.subscription.updated processed successfully.`);
      } else {
        console.warn(`[Stripe Webhook] No matching userSubscription found for stripeCustomerId: ${stripeCustomerId}`);
      }
    } catch (error: any) {
      console.error(`[Stripe Webhook] customer.subscription.updated error:`, error.message);
    }
  } else if (event.type === "customer.subscription.deleted") {
    try {
      const subscription = event.data.object as any;
      const stripeCustomerId = subscription.customer;

      console.log(`[Stripe Webhook] customer.subscription.deleted: customer=${stripeCustomerId}`);

      const subRecord = await prisma.userSubscription.findFirst({
        where: { stripeCustomerId },
      });

      if (subRecord) {
        // Update userSubscription
        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: {
            status: "canceled" as any,
          },
        });

        // Update User
        await prisma.user.update({
          where: { id: subRecord.userId },
          data: {
            isSubscribed: false,
            trialStatus: "EXPIRED" as any,
          },
        });

        const config = await prisma.myPlusLeadsConfig.findUnique({
          where: { userId: subRecord.userId },
        });

        if (config?.subAccountId && config.status === "CONNECTED") {
          try {
            await disableMyPlusLeadsAccount(config.subAccountId);
            await prisma.myPlusLeadsConfig.update({
              where: { userId: subRecord.userId },
              data: { status: "NEED_SETUP", errorMessage: null },
            });
          } catch (err) {
            console.error("[Stripe Webhook] MyPlusLeads disable failed:", err);
          }
        }

        console.log(`[Stripe Webhook] customer.subscription.deleted processed successfully.`);
      } else {
        console.warn(`[Stripe Webhook] No matching userSubscription found for stripeCustomerId: ${stripeCustomerId}`);
      }
    } catch (error: any) {
      console.error(`[Stripe Webhook] customer.subscription.deleted error:`, error.message);
    }
  } else if (event.type === "invoice.payment_failed") {
    try {
      const invoice = event.data.object as any;
      const stripeCustomerId = invoice.customer;

      console.log(`[Stripe Webhook] invoice.payment_failed: customer=${stripeCustomerId}`);

      const subRecord = await prisma.userSubscription.findFirst({
        where: { stripeCustomerId },
      });

      if (subRecord) {
        // Update userSubscription
        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: {
            status: "past_due" as any,
          },
        });

        // Update User
        await prisma.user.update({
          where: { id: subRecord.userId },
          data: {
            isSubscribed: false,
          },
        });

        console.log(`[Stripe Webhook] invoice.payment_failed processed successfully.`);
      } else {
        console.warn(`[Stripe Webhook] No matching userSubscription found for stripeCustomerId: ${stripeCustomerId}`);
      }
    } catch (error: any) {
      console.error(`[Stripe Webhook] invoice.payment_failed error:`, error.message);
    }
  }

  res.json({ received: true });
};
