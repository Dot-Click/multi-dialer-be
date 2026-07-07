import { Request, Response } from "express";
import crypto from "crypto";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount, purchaseUSPhoneNumber, getTwilioClient, releaseNumber } from "../../services/twilio-account.service";
import { cancelAddonSubscriptionForUser } from "../../services/phoneNumberBilling.service";
import { envConfig } from "../../lib/config";
import { triggerZapierWebhook } from "../../lib/zapier";
import { createMyPlusLeadsAccount, disableMyPlusLeadsAccount, syncLeadsForUser } from "../../services/myPlusLeads.service";
import { encryptEIN as encrypt } from "../../utils/encryption";
import { syncBillingFromInvoice } from "../../services/billingLedger.service";
import { resolveInvoiceCard } from "../../services/stripeInvoiceCard.service";

function getStripeClient() {
  const key = envConfig.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

// Mirror a Stripe invoice into the local Billing ledger (shared with the backfill
// script). Wrapped so ledger errors never break the main webhook flow.
async function mirrorInvoiceToBilling(
  stripe: any,
  invoice: any,
  status: "PAID" | "FAILED" | "PENDING",
): Promise<void> {
  try {
    // The webhook payload's invoice is NOT expanded. On the current Stripe API
    // (2026-04-22.dahlia) the paying card lives behind
    // invoice.payments → payment_intent → charge, which must be expanded — so
    // re-fetch the invoice here. Without this, resolveInvoiceCard found nothing
    // and cardBrand/cardLast4 were never written to the ledger.
    let full = invoice;
    if (invoice?.id) {
      try {
        full = await stripe.invoices.retrieve(invoice.id, {
          expand: ["payments.data.payment.payment_intent"],
        });
      } catch (e: any) {
        console.warn(`[Stripe Webhook] Could not expand invoice ${invoice.id}: ${e?.message}`);
      }
    }

    // Capture the paying card for PAID invoices so the ledger powers the payment
    // method column directly (no live Stripe call per row at read time).
    const card = status === "PAID" ? await resolveInvoiceCard(stripe, full) : null;
    const result = await syncBillingFromInvoice(full, status, card);
    if (result === "upserted") {
      console.log(`[Stripe Webhook] Billing ledger upserted: invoice=${full?.id} status=${status} card=${card?.brand ?? "none"}`);
    }
  } catch (err: any) {
    console.error(`[Stripe Webhook] Billing sync failed for invoice ${invoice?.id}:`, err.message);
  }
}

// Releases every PAID_ADDON number billed on an invoice back to Twilio and
// removes it, once Stripe has given up collecting for that invoice. Matches
// invoice line items to CallerId rows via stripeSubscriptionItemId. Safe to
// call more than once for the same invoice — already-removed numbers simply
// won't be found and are skipped.
async function releaseAddonNumbersForUncollectibleInvoice(invoice: any): Promise<void> {
  const subscriptionItemIds: string[] = (invoice.lines?.data || [])
    .map((line: any) => line.subscription_item)
    .filter(Boolean);

  for (const subscriptionItemId of subscriptionItemIds) {
    const callerId = await prisma.callerId.findFirst({
      where: { stripeSubscriptionItemId: subscriptionItemId },
      include: { systemSetting: { select: { userId: true } } },
    });
    if (!callerId) continue;

    const ownerUserId = callerId.systemSetting.userId;
    console.log(`[Stripe Webhook] Releasing unpaid add-on number ${callerId.twillioNumber} for user ${ownerUserId}.`);

    if (callerId.twillioSid) {
      const ownerClient = await getTwilioClient(ownerUserId);
      await releaseNumber(callerId.twillioSid, ownerClient).catch((err: any) =>
        console.error(`[Stripe Webhook] Failed to release ${callerId.twillioSid}:`, err.message)
      );
    }

    await prisma.callerId.delete({ where: { id: callerId.id } }).catch(() => undefined);

    const remaining = await prisma.callerId.count({
      where: { billingSource: "PAID_ADDON", systemSetting: { userId: ownerUserId } },
    });
    if (remaining === 0) {
      await cancelAddonSubscriptionForUser(ownerUserId);
    }
  }
}

// Releases every phone number this user owns (both plan-included and paid
// add-ons) back to Twilio and hard-deletes them, then cancels their dedicated
// add-on Stripe subscription. Used when their plan subscription fully ends —
// at that point we have no ongoing billing relationship, so we stop paying
// Twilio for any of their numbers, not just the paid extras.
async function releaseAllNumbersForUser(userId: string): Promise<void> {
  const callerIds = await prisma.callerId.findMany({
    where: { systemSetting: { userId } },
    select: { id: true, twillioSid: true },
  });

  if (callerIds.length === 0) return;

  const ownerClient = await getTwilioClient(userId);
  for (const c of callerIds) {
    if (c.twillioSid) {
      await releaseNumber(c.twillioSid, ownerClient).catch((err: any) =>
        console.error(`[Stripe Webhook] Failed to release number ${c.twillioSid} for user ${userId}:`, err.message)
      );
    }
  }

  await prisma.callerId.deleteMany({ where: { id: { in: callerIds.map((c) => c.id) } } });
  await cancelAddonSubscriptionForUser(userId);

  console.log(`[Stripe Webhook] Released ${callerIds.length} number(s) for canceled user ${userId}.`);
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
      const { fullName, hashedPassword, companyName } = metadata;
      // Normalize to match Better Auth's lowercased sign-in lookup.
      const email = String(metadata.email).trim().toLowerCase();
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

        // plan holds the real (dynamic) Stripe product name — what the billing UI shows.
        let planName: string = "STARTER";
        let billingCycle: any = "MONTHLY";
        // amount is stored in whole dollars as a string (matches Plan.monthlyAmount
        // and how the reporting/MRR sums it); usersCount = subscribed seat quantity.
        let amountStr: string | null = null;
        let usersCount = 1;

        if (stripeSubscriptionId) {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            const item = stripeSub.items.data[0];
            const interval = item?.price?.recurring?.interval;
            billingCycle = interval === "year" ? "YEARLY" : "MONTHLY";

            const quantity = item?.quantity ?? 1;
            usersCount = quantity;
            if (typeof item?.price?.unit_amount === "number") {
              amountStr = String((item.price.unit_amount / 100) * quantity);
            }

            const priceId = item?.price?.id;
            if (priceId) {
              const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
              const product = price.product as any;
              if (product?.name) planName = product.name;
            }
          } catch (err) {
            console.error("[Stripe Webhook] Could not resolve plan from Stripe subscription:", err);
          }
        }

        newUserSubscription = await prisma.userSubscription.create({
          data: {
            userId: newUser.id,
            plan: planName,
            status: "ACTIVE",
            startDate: new Date(),
            stripeCustomerId: stripeCustomerId || null,
            stripeSubscriptionId: stripeSubscriptionId || null,
            billingCycle,
            amount: amountStr,
            usersCount,
          },
        });

        await prisma.user.update({
          where: { id: newUser.id },
          data: { isSubscribed: true },
        });

        console.log(`[Stripe Webhook] UserSubscription created for ${email}: plan=${planName}, cycle=${billingCycle}`);

        const subEmail = `slingvo.${newUser.id.replace(/-/g, "")}@slingvo.com`;
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
            zip: defaultBaseZip || "78701",
            baseZip: defaultBaseZip || "78701",
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
            .catch(async (err) => {
              const message = err?.message ?? String(err);
              console.error(`[MyPlusLeads] Initial sync failed for ${email}:`, message);
              await prisma.myPlusLeadsConfig.update({
                where: { userId: newUser.id },
                data: { errorMessage: message },
              }).catch(() => undefined);
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
      const item = subscription.items.data[0];
      const priceId = item.price.id;

      console.log(`[Stripe Webhook] customer.subscription.updated: customer=${stripeCustomerId}, status=${status}, priceId=${priceId}`);

      const subRecord = await prisma.userSubscription.findFirst({
        where: { stripeCustomerId },
      });

      if (subRecord) {
        // Keep money fields in sync on plan/quantity changes.
        const quantity = item?.quantity ?? subRecord.usersCount ?? 1;
        const billingCycle = item?.price?.recurring?.interval === "year" ? "YEARLY" : "MONTHLY";
        const amountStr = typeof item?.price?.unit_amount === "number"
          ? String((item.price.unit_amount / 100) * quantity)
          : subRecord.amount;

        // Capture the real (dynamic) product name for the new plan.
        let planName: string = subRecord.plan;
        try {
          const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
          const product = price.product as any;
          if (product?.name) planName = product.name;
        } catch (err: any) {
          console.error(`[Stripe Webhook] Could not resolve product name on update:`, err?.message);
        }

        await prisma.userSubscription.update({
          where: { id: subRecord.id },
          data: {
            plan: planName,
            status: status as any,
            amount: amountStr,
            usersCount: quantity,
            billingCycle: billingCycle as any,
          },
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

        try {
          await releaseAllNumbersForUser(subRecord.userId);
        } catch (err: any) {
          console.error(`[Stripe Webhook] Failed to release numbers for canceled user ${subRecord.userId}:`, err.message);
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

      console.log(`[Stripe Webhook] invoice.payment_failed: customer=${stripeCustomerId}, next_payment_attempt=${invoice.next_payment_attempt}`);

      // Mirror into the local Billing ledger as a FAILED invoice.
      await mirrorInvoiceToBilling(stripe, invoice, "FAILED");

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
        // Not the main plan subscription — check if this is the dedicated
        // phone-number add-on subscription instead.
        console.warn(`[Stripe Webhook] No matching userSubscription found for stripeCustomerId: ${stripeCustomerId}`);
      }

      // `next_payment_attempt` is null once Stripe has exhausted all retries
      // for this invoice — regardless of whether the account's dunning
      // settings are configured to also mark it "uncollectible". This is the
      // reliable signal to release any add-on numbers billed on it.
      if (invoice.next_payment_attempt === null) {
        await releaseAddonNumbersForUncollectibleInvoice(invoice);
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

      // Mirror into the local Billing ledger.
      await mirrorInvoiceToBilling(stripe, invoice, "PAID");

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

  // ─── invoice.marked_uncollectible ─────────────────────────────────────────
  // Only fires if the account's dunning settings are configured to
  // auto-mark invoices uncollectible after final retry — not guaranteed.
  // The reliable release path is `next_payment_attempt === null` in
  // invoice.payment_failed above; this is a secondary, idempotent catch-all
  // for accounts that do have that setting on.
  } else if (event.type === "invoice.marked_uncollectible") {
    try {
      const invoice = event.data.object as any;
      console.log(`[Stripe Webhook] invoice.marked_uncollectible: id=${invoice.id}, customer=${invoice.customer}`);

      await releaseAddonNumbersForUncollectibleInvoice(invoice);

      await persistEvent("PROCESSED");
    } catch (error: any) {
      console.error(`[Stripe Webhook] invoice.marked_uncollectible error:`, error.message);
      await persistEvent("FAILED");
    }

  // ─── invoice.created (log only) ───────────────────────────────────────────
  } else if (event.type === "invoice.created") {
    const invoice = event.data.object as any;
    console.log(`[Stripe Webhook] invoice.created: id=${invoice.id}, customer=${invoice.customer}, amount_due=${invoice.amount_due}`);
    // Record the open invoice in the Billing ledger as PENDING.
    await mirrorInvoiceToBilling(stripe, invoice, "PENDING");
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
    // Mark the related invoice's Billing row as REFUNDED (if we have it).
    try {
      const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id;
      if (invoiceId) {
        await prisma.billing.updateMany({
          where: { stripeInvoiceId: invoiceId },
          data: { status: "REFUNDED" as any },
        });
      }
    } catch (err: any) {
      console.error(`[Stripe Webhook] Billing refund sync failed for charge ${charge?.id}:`, err.message);
    }
    await persistEvent("PROCESSED");

  // ─── payment_method.attached (log + best-effort card sync) ───────────────
  // Confirms an attach succeeded even if the admin's synchronous request was
  // interrupted; the authoritative "this is now the default" sync happens in
  // customer.updated below.
  } else if (event.type === "payment_method.attached") {
    try {
      const pm = event.data.object as any;
      const stripeCustomerId = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
      console.log(`[Stripe Webhook] payment_method.attached: pm=${pm.id}, customer=${stripeCustomerId}`);
      await persistEvent("PROCESSED");
    } catch (error: any) {
      console.error(`[Stripe Webhook] payment_method.attached error:`, error.message);
      await persistEvent("FAILED");
    }

  // ─── payment_method.detached (log only) ───────────────────────────────────
  } else if (event.type === "payment_method.detached") {
    const pm = event.data.object as any;
    console.log(`[Stripe Webhook] payment_method.detached: pm=${pm.id}`);
    await persistEvent("PROCESSED");

  // ─── customer.updated (sync default payment method / card summary) ───────
  // Catches changes made outside our admin flow (e.g. directly in the Stripe
  // Dashboard) so the locally-cached card summary never drifts from Stripe.
  } else if (event.type === "customer.updated") {
    try {
      const customer = event.data.object as any;
      const stripeCustomerId = customer.id as string;
      const defaultPmId: string | null =
        typeof customer.invoice_settings?.default_payment_method === "string"
          ? customer.invoice_settings.default_payment_method
          : customer.invoice_settings?.default_payment_method?.id ?? null;

      if (defaultPmId) {
        const subRecord = await prisma.userSubscription.findFirst({ where: { stripeCustomerId } });
        if (subRecord && subRecord.defaultPaymentMethodId !== defaultPmId) {
          const pm = await stripe.paymentMethods.retrieve(defaultPmId).catch(() => null);
          const card = pm?.card;
          await prisma.userSubscription.update({
            where: { id: subRecord.id },
            data: {
              defaultPaymentMethodId: defaultPmId,
              cardBrand: card?.brand ?? subRecord.cardBrand,
              cardLast4: card?.last4 ?? subRecord.cardLast4,
              cardExpMonth: card?.exp_month ?? subRecord.cardExpMonth,
              cardExpYear: card?.exp_year ?? subRecord.cardExpYear,
            },
          });
          console.log(`[Stripe Webhook] customer.updated: synced default payment method for customer ${stripeCustomerId}`);
        }
      }

      await persistEvent("PROCESSED");
    } catch (error: any) {
      console.error(`[Stripe Webhook] customer.updated error:`, error.message);
      await persistEvent("FAILED");
    }

  } else {
    console.log(`[Stripe Webhook] Unhandled event type: ${event.type} (id=${stripeEventId})`);
  }

  res.json({ received: true });
};
