import { Request, Response } from "express";
import crypto from "crypto";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount, purchaseUSPhoneNumber, getTwilioClient, releaseNumber } from "../../services/twilio-account.service";
import { cancelAddonSubscriptionForUser } from "../../services/phoneNumberBilling.service";
import { removeAgentSeatSubscriptionItem } from "../../services/agentSeatBilling.service";
import { sendEmail } from "../../utils/email";
import { envConfig } from "../../lib/config";
import { triggerZapierWebhook } from "../../lib/zapier";
import { notifyClients } from "../../services/leadStoreNotify.service";
import { syncBillingFromInvoice } from "../../services/billingLedger.service";
import { resolveInvoiceCard } from "../../services/stripeInvoiceCard.service";
import { planKeyFromName } from "../../services/planLimits.service";

// UserSubscription.status is a fixed Postgres enum (ACTIVE | CANCELLED | EXPIRED
// | PENDING) — it does NOT contain Stripe's own lowercase status strings
// (active, past_due, unpaid, canceled, incomplete, trialing, paused...).
// Writing a raw Stripe status directly throws PrismaClientValidationError at
// runtime ("Invalid value for argument `status`"). Map to the closest existing
// enum member instead — PENDING stands in for "payment trouble, not yet fully
// lapsed" (past_due/unpaid/incomplete/paused), since there's no dedicated
// PAST_DUE value without a schema migration.
function mapStripeSubscriptionStatus(stripeStatus: string): "ACTIVE" | "CANCELLED" | "EXPIRED" | "PENDING" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELLED";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "paused":
      return "PENDING";
    default:
      return "PENDING";
  }
}

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

// Bans every agent whose paid overage seat was billed on an invoice Stripe
// has given up collecting on, and alerts the owning admin. Matches invoice
// line items to User rows via stripeAgentSeatItemId. Cancels the underlying
// subscription item so the deactivated seat stops being billed, and clears
// the seat-billing fields so the freed slot no longer counts against the
// admin's paid-overage total. Safe to call more than once for the same
// invoice — already-banned agents simply won't be found and are skipped.
async function deactivateAgentSeatsForUncollectibleInvoice(invoice: any): Promise<void> {
  const subscriptionItemIds: string[] = (invoice.lines?.data || [])
    .map((line: any) => line.subscription_item)
    .filter(Boolean);

  for (const subscriptionItemId of subscriptionItemIds) {
    const agent = await prisma.user.findFirst({
      where: { stripeAgentSeatItemId: subscriptionItemId },
      include: { createdBy: { select: { id: true, email: true, fullName: true } } },
    });
    if (!agent) continue;

    console.log(`[Stripe Webhook] Deactivating unpaid overage agent seat ${agent.id} (${agent.email}) for admin ${agent.createdById}.`);

    await removeAgentSeatSubscriptionItem(subscriptionItemId);

    await prisma.user.update({
      where: { id: agent.id },
      data: {
        banned: true,
        banReason: "Unpaid extra agent seat",
        stripeAgentSeatItemId: null,
        agentSeatMonthlyPriceCents: null,
      },
    });

    if (agent.createdBy?.email) {
      await sendEmail(
        agent.createdBy.email,
        "Extra Agent Seat Payment Failed — Agent Deactivated",
        `<div style="font-family: Arial, sans-serif; padding: 20px;">
          <p>Hi ${agent.createdBy.fullName ?? "there"},</p>
          <p>We were unable to collect payment for the extra agent seat billed for <strong>${agent.fullName ?? agent.email}</strong>. This agent's account has been deactivated.</p>
          <p>Update your payment method and re-purchase the seat from User Management to restore access.</p>
        </div>`
      ).catch((err: any) => console.error(`[Stripe Webhook] Failed to send seat-payment-failed email to ${agent.createdBy?.email}:`, err.message));
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

    // Existing logged-in user starting their first subscription (e.g. a trial
    // account that never went through signup checkout) — see
    // startSubscriptionCheckout in billing/controller.ts. Attaches the new
    // Stripe subscription to their existing account instead of provisioning
    // a brand-new one.
    if (metadata?.isExistingUserSubscribe === "true" && metadata.userId) {
      try {
        const userId = metadata.userId as string;
        const stripeCustomerId = session.customer as string | null;
        const stripeSubscriptionId = session.subscription as string | null;

        let planName = "STARTER";
        let billingCycle: any = "MONTHLY";
        let amountStr: string | null = null;
        let usersCount = 1;

        if (stripeSubscriptionId) {
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
        }

        await prisma.userSubscription.create({
          data: {
            userId,
            plan: planName,
            status: "ACTIVE",
            startDate: new Date(),
            stripeCustomerId,
            stripeSubscriptionId,
            billingCycle,
            amount: amountStr,
            usersCount,
          },
        });

        await prisma.user.update({
          where: { id: userId },
          data: { isSubscribed: true },
        });

        console.log(`[Stripe Webhook] Subscription started for existing user ${userId}: plan=${planName}, cycle=${billingCycle}`);
        await persistEvent("PROCESSED");
      } catch (error: any) {
        console.error(`[Stripe Webhook] Existing-user subscription start failed:`, error.message);
        await persistEvent("FAILED");
      }

      res.json({ received: true });
      return;
    }

    // Lead Store purchase — see subscribeToLeadStoreService in leadStore/controller.ts.
    // Creates a PENDING_SETUP LeadStore row and notifies Client to manually link
    // a MyPlusLeads account; never auto-provisions anything with MyPlusLeads.
    if (metadata?.purpose === "lead_store" && metadata.userId && metadata.leadStoreServiceId) {
      try {
        const userId = metadata.userId as string;
        const serviceId = metadata.leadStoreServiceId as string;
        const stripeSubscriptionId = session.subscription as string | null;

        const service = await prisma.leadStoreService.findUnique({ where: { id: serviceId } });
        if (!service) throw new Error(`LeadStoreService ${serviceId} not found`);

        const invoiceNumber = `LS-${session.id}`;
        const billing = await prisma.billing.create({
          data: {
            userId,
            invoiceNumber,
            planName: service.name,
            amount: service.price,
            currency: "usd",
            date: new Date(),
            status: "PENDING",
            billingCycle: "MONTHLY",
          },
        });

        const leadStore = await prisma.leadStore.create({
          data: {
            title: service.name,
            description: service.description || "",
            price: service.price,
            userId,
            billingId: billing.id,
            serviceId: service.id,
            status: "PENDING_SETUP",
            stripeSubscriptionId,
          },
        });

        await notifyClients(
          "New Lead Store subscription needs setup",
          `A customer just subscribed to "${service.name}" and needs a MyPlusLeads account assigned. Link one in the Super Admin Lead Store panel.`,
          "lead_store_needs_setup",
        );

        console.log(`[Stripe Webhook] Lead Store purchase recorded: leadStoreId=${leadStore.id}, userId=${userId}, service=${service.name}`);
        await persistEvent("PROCESSED");
      } catch (error: any) {
        console.error(`[Stripe Webhook] Lead Store purchase handling failed:`, error.message);
        await persistEvent("FAILED");
      }

      res.json({ received: true });
      return;
    }

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

        // 5. Create UserSubscription record — resolved before the phone number
        // purchase below, since how many numbers to buy depends on this plan's
        // included-numbers entitlement.
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

        // 5.5 Buy this plan's included phone numbers (STRICT: No internal try/catch).
        // These are free — part of the plan, not the paid add-on flow in
        // phoneNumberBilling.service.ts. `includedNumbers` is null when a plan
        // has no matching PlanLimit row (fail-open/unlimited) — that means "no
        // cap on how many they may buy", not "buy unlimited at signup", so we
        // fall back to a single starter number, matching prior behavior.
        const planKey = planKeyFromName(planName);
        const planLimit = await prisma.planLimit.findUnique({ where: { planKey } });
        const includedNumbersToPurchase = planLimit
          ? Math.max(0, planLimit.includedNumbers ?? 1)
          : 1;

        console.log(
          `[Stripe Webhook] Purchasing ${includedNumbersToPurchase} included number(s) for ${email} (plan=${planName}).`,
        );

        for (let i = 0; i < includedNumbersToPurchase; i++) {
          const purchased = await purchaseUSPhoneNumber(subAccount.sid, subAccount.authToken);

          await prisma.callerId.create({
            data: {
              label: i === 0 ? `Primary Line (${purchased.phoneNumber})` : `Line ${i + 1} (${purchased.phoneNumber})`,
              countryCode: "US",
              twillioNumber: purchased.phoneNumber,
              twillioSid: purchased.sid,
              systemSettingId: systemSetting.id,
              numberOfLines: 1,
            },
          });
        }

        // 6. Setup basic Library and folders
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
      const stripeSubscriptionId = subscription.id as string;
      const status = subscription.status;
      const item = subscription.items.data[0];
      const priceId = item.price.id;

      console.log(`[Stripe Webhook] customer.subscription.updated: customer=${stripeCustomerId}, status=${status}, priceId=${priceId}`);

      // Lead Store add-on subscriptions are separate Stripe Subscription objects
      // from the main plan (same customer) — this event doesn't apply to the
      // main plan record if it belongs to one of those instead.
      const isLeadStoreSubscription = await prisma.leadStore.findFirst({
        where: { stripeSubscriptionId },
        select: { id: true },
      });

      const subRecord = isLeadStoreSubscription
        ? null
        : await prisma.userSubscription.findFirst({
            where: { stripeCustomerId },
          });

      if (isLeadStoreSubscription) {
        console.log(`[Stripe Webhook] customer.subscription.updated is for a Lead Store subscription (leadStoreId=${isLeadStoreSubscription.id}) — no main-plan action taken.`);
      } else if (subRecord) {
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
            status: mapStripeSubscriptionStatus(status),
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
      const stripeSubscriptionId = subscription.id as string;

      console.log(`[Stripe Webhook] customer.subscription.deleted: customer=${stripeCustomerId}, subscription=${stripeSubscriptionId}`);

      // Lead Store add-on subscriptions are separate Stripe Subscription objects
      // from the main plan (same customer) — check for that first so cancelling
      // one doesn't get misread as the customer cancelling their whole plan.
      const leadStore = await prisma.leadStore.findFirst({
        where: { stripeSubscriptionId },
        include: { user: { select: { fullName: true, email: true } }, service: { select: { name: true } } },
      });

      if (leadStore) {
        await prisma.leadStore.update({
          where: { id: leadStore.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });

        await notifyClients(
          "Lead Store subscription cancelled",
          `"${leadStore.service.name}" for ${leadStore.user.fullName || leadStore.user.email} was cancelled. Disable it on your MyPlusLeads account when convenient.`,
          "lead_store_cancelled",
        ).catch((err) => console.error("[Stripe Webhook] Lead Store cancel notify failed:", err));

        console.log(`[Stripe Webhook] Lead Store subscription cancelled: leadStoreId=${leadStore.id}`);
        await persistEvent("PROCESSED");
      } else {
        const subRecord = await prisma.userSubscription.findFirst({
          where: { stripeCustomerId },
        });

        if (subRecord) {
          await prisma.userSubscription.update({
            where: { id: subRecord.id },
            data: { status: "CANCELLED" },
          });

          await prisma.user.update({
            where: { id: subRecord.userId },
            data: {
              isSubscribed: false,
              trialStatus: "EXPIRED" as any,
            },
          });

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
      }
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
          data: { status: "PENDING" },
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
      await deactivateAgentSeatsForUncollectibleInvoice(invoice);

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
