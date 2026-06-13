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

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Signature verification failed:`, err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const stripeEventId: string = event.id;

  // Idempotency: skip events we have already processed successfully
  try {
    const duplicate = await prisma.billingEvent.findUnique({ where: { stripeEventId } });
    if (duplicate) {
      console.log(`[Stripe Webhook] Duplicate event ${stripeEventId} (${event.type}), skipping.`);
      res.json({ received: true });
      return;
    }
  } catch (err: any) {
    // A lookup failure should not block processing — log and proceed
    console.error(`[Stripe Webhook] Idempotency check failed for ${stripeEventId}:`, err.message);
  }

  // Persists the event outcome. Swallows its own errors so a logging failure
  // never obscures the real handler result.
  const persistEvent = async (status: "PROCESSED" | "FAILED") => {
    try {
      await prisma.billingEvent.create({
        data: {
          stripeEventId,
          type: event.type,
          payload: event.data.object,
          status,
        },
      });
    } catch (err: any) {
      console.error(`[Stripe Webhook] Failed to write BillingEvent for ${stripeEventId}:`, err.message);
    }
  };

  // ─── checkout.session.completed ───────────────────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    const metadata = session.metadata;

    if (metadata && metadata.email) {
      const { fullName, email, hashedPassword, companyName } = metadata;
      let newUser: any = null;
      let newUserSubscription: any = null;

      try {
        console.log(`[Stripe Webhook] Processing new signup for ${email}`);

        // 0. Check for existing user (Idempotency)
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
          if (metadata?.isManualProvision === "true" || metadata?.userId) {
            const stripeCustomerId = session.customer as string | null;
            await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                isSubscribed: true,
                ...(stripeCustomerId ? { stripeCustomerId } : {}),
              },
            });
            console.log(`[Stripe Webhook] Manual user ${email} subscription activated (customer: ${stripeCustomerId}).`);
          } else {
            console.log(`[Stripe Webhook] User ${email} already exists, skipping provisioning.`);
          }
          await persistEvent("PROCESSED");
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
          },
        });

        // 2. Create the Company
        if (companyName) {
          await prisma.company.create({
            data: {
              companyName: companyName,
              userId: newUser.id,
            },
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
              apiKeySecret: subAccount.apiKeySecret,
            },
          },
        });

        // 4.5 Buy a US Phone Number (STRICT: No internal try/catch)
        // TODO: Uncomment in production — auto-purchases a phone number for the user's sub-account
        console.log(`[Stripe Webhook] Skipping primary US number purchase for ${email} (Provisioning Disabled)`);

        const purchased = await purchaseUSPhoneNumber(subAccount.sid, subAccount.authToken);

        await prisma.callerId.create({
          data: {
            label: `Primary Line (${purchased.phoneNumber})`,
            countryCode: "US",
            twillioNumber: purchased.phoneNumber,
            twillioSid: purchased.sid,
            systemSettingId: systemSetting.id,
            numberOfLines: 1,
          },
        });

        // 5. Setup basic Library and folders
        await prisma.library.create({
          data: { userId: newUser.id },
        });

        await prisma.contactFolder.create({
          data: {
            name: "General Leads",
            isSystem: true,
            userId: newUser.id,
          },
        });

        // 6. Create UserSubscription record
        const stripeCustomerId = session.customer as string | null;
        const stripeSubscriptionId = session.subscription as string | null;

        let planKey: any = "STARTER";
        let billingCycle: any = "MONTHLY";

        if (stripeSubscriptionId) {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            const interval = stripeSub.items.data[0]?.price?.recurring?.interval;
            billingCycle = interval === "year" ? "YEARLY" : "MONTHLY";
            const priceId = stripeSub.items.data[0]?.price?.id;
            if (priceId) {
              const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
              const product = price.product as any;
              if (product?.metadata?.plan) planKey = product.metadata.plan;
            }
          } catch (err) {
            console.error("[Stripe Webhook] Could not resolve plan from Stripe subscription:", err);
          }
        }

        newUserSubscription = await prisma.userSubscription.create({
          data: {
            userId: newUser.id,
            plan: planKey,
            status: "ACTIVE",
            startDate: new Date(),
            stripeCustomerId: stripeCustomerId || null,
            stripeSubscriptionId: stripeSubscriptionId || null,
            billingCycle,
          },
        });

        await prisma.user.update({
          where: { id: newUser.id },
          data: { isSubscribed: true },
        });

        console.log(`[Stripe Webhook] UserSubscription created for ${email}: plan=${planKey}, cycle=${billingCycle}`);

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
              subAccountId: accountId != null ? String(accountId) : null,
              status: "CONNECTED",
              errorMessage: null,
            },
          });

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

        await persistEvent("PROCESSED");
      } catch (error: any) {
        console.error(`[Stripe Webhook] Provisioning FAILED for ${email}. Rolling back...`, error.message);

        // ROLLBACK: Delete subscription first (FK), then user (cascades Company, Account, Integrations, etc.)
        if (newUserSubscription?.id) {
          try {
            await prisma.userSubscription.delete({ where: { id: newUserSubscription.id } });
          } catch (cleanupError) {
            console.error(`[Stripe Webhook] Rollback: failed to delete UserSubscription:`, cleanupError);
          }
        }
        if (newUser?.id) {
          try {
            await prisma.user.delete({ where: { id: newUser.id } });
            console.log(`[Stripe Webhook] Rollback successful. Deleted user ${email}`);
          } catch (cleanupError) {
            console.error(`[Stripe Webhook] Rollback cleanup failed:`, cleanupError);
          }
        }

        await persistEvent("FAILED");
        res.status(500).send(`Provisioning failed: ${error.message}`);
        return;
      }
    } else {
      // No metadata.email — nothing to provision
      console.log(`[Stripe Webhook] checkout.session.completed with no metadata.email, skipping provisioning.`);
      await persistEvent("PROCESSED");
    }

  // ─── customer.subscription.updated ────────────────────────────────────────
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
        let mappedPlan: any = "STARTER";
        if (priceId === process.env.STRIPE_PRICE_STANDARD) {
          mappedPlan = "PROFESSIONAL";
        } else if (priceId === process.env.STRIPE_PRICE_PREMIUM) {
          mappedPlan = "ENTERPRISE";
        }

        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: { plan: mappedPlan, status: status as any },
        });

        await prisma.user.update({
          where: { id: subRecord.userId },
          data: { isSubscribed: status === "active" },
        });

        console.log(`[Stripe Webhook] customer.subscription.updated processed successfully.`);
      } else {
        console.warn(`[Stripe Webhook] No matching userSubscription found for stripeCustomerId: ${stripeCustomerId}`);
      }

      await persistEvent("PROCESSED");
    } catch (error: any) {
      console.error(`[Stripe Webhook] customer.subscription.updated error:`, error.message);
      await persistEvent("FAILED");
    }

  // ─── customer.subscription.deleted ────────────────────────────────────────
  } else if (event.type === "customer.subscription.deleted") {
    try {
      const subscription = event.data.object as any;
      const stripeCustomerId = subscription.customer;

      console.log(`[Stripe Webhook] customer.subscription.deleted: customer=${stripeCustomerId}`);

      const subRecord = await prisma.userSubscription.findFirst({
        where: { stripeCustomerId },
      });

      if (subRecord) {
        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: { status: "canceled" as any },
        });

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

      await persistEvent("PROCESSED");
    } catch (error: any) {
      console.error(`[Stripe Webhook] customer.subscription.deleted error:`, error.message);
      await persistEvent("FAILED");
    }

  // ─── invoice.payment_failed ────────────────────────────────────────────────
  } else if (event.type === "invoice.payment_failed") {
    try {
      const invoice = event.data.object as any;
      const stripeCustomerId = invoice.customer;

      console.log(`[Stripe Webhook] invoice.payment_failed: customer=${stripeCustomerId}`);

      const subRecord = await prisma.userSubscription.findFirst({
        where: { stripeCustomerId },
      });

      if (subRecord) {
        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: { status: "past_due" as any },
        });

        await prisma.user.update({
          where: { id: subRecord.userId },
          data: { isSubscribed: false },
        });

        console.log(`[Stripe Webhook] invoice.payment_failed processed successfully.`);
      } else {
        console.warn(`[Stripe Webhook] No matching userSubscription found for stripeCustomerId: ${stripeCustomerId}`);
      }

      await persistEvent("PROCESSED");
    } catch (error: any) {
      console.error(`[Stripe Webhook] invoice.payment_failed error:`, error.message);
      await persistEvent("FAILED");
    }

  // ─── invoice.paid ─────────────────────────────────────────────────────────
  } else if (event.type === "invoice.paid") {
    try {
      const invoice = event.data.object as any;
      const stripeCustomerId = invoice.customer;

      console.log(`[Stripe Webhook] invoice.paid: customer=${stripeCustomerId}, amount_paid=${invoice.amount_paid}`);

      const subRecord = await prisma.userSubscription.findFirst({
        where: { stripeCustomerId },
      });

      if (subRecord) {
        // Mark subscription active (recovers from past_due) and re-enable user access
        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: { status: "ACTIVE" },
        });

        await prisma.user.update({
          where: { id: subRecord.userId },
          data: { isSubscribed: true },
        });

        console.log(`[Stripe Webhook] invoice.paid: subscription reactivated for customer ${stripeCustomerId}.`);
      } else {
        console.warn(`[Stripe Webhook] invoice.paid: no matching userSubscription for stripeCustomerId: ${stripeCustomerId}`);
      }

      await persistEvent("PROCESSED");
    } catch (error: any) {
      console.error(`[Stripe Webhook] invoice.paid error:`, error.message);
      await persistEvent("FAILED");
    }

  // ─── invoice.created (log only) ───────────────────────────────────────────
  } else if (event.type === "invoice.created") {
    const invoice = event.data.object as any;
    console.log(`[Stripe Webhook] invoice.created: id=${invoice.id}, customer=${invoice.customer}, amount_due=${invoice.amount_due}`);
    await persistEvent("PROCESSED");

  // ─── payment_intent.succeeded (log only) ──────────────────────────────────
  } else if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as any;
    console.log(`[Stripe Webhook] payment_intent.succeeded: id=${pi.id}, amount=${pi.amount}, customer=${pi.customer}`);
    await persistEvent("PROCESSED");

  // ─── payment_intent.payment_failed (log only) ─────────────────────────────
  } else if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as any;
    console.log(`[Stripe Webhook] payment_intent.payment_failed: id=${pi.id}, error=${pi.last_payment_error?.message}`);
    await persistEvent("PROCESSED");

  // ─── charge.refunded (log only) ───────────────────────────────────────────
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as any;
    console.log(`[Stripe Webhook] charge.refunded: id=${charge.id}, amount_refunded=${charge.amount_refunded}, customer=${charge.customer}`);
    await persistEvent("PROCESSED");

  } else {
    console.log(`[Stripe Webhook] Unhandled event type: ${event.type} (id=${stripeEventId})`);
  }

  res.json({ received: true });
};
