import bcrypt from "bcryptjs";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount } from "../../services/twilio-account.service";
import { DEFAULT_MISC_FIELDS } from "../systemSettings/miscFields/defaults";
import { triggerZapierWebhook } from "../../lib/zapier";
import { sendEmail } from "../../utils/email";
import { envConfig } from "../../lib/config";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: "2026-04-22.dahlia",
});

function throwHttp(statusCode: number, message: string): never {
    throw { message, statusCode };
}

export async function createUserInDb(payload: any) {
    const { password, planId, ...rest } = payload;

    // Normalize the email the same way Better Auth does at sign-in (lowercased +
    // trimmed). Without this, a mixed-case email like "Nate101h@gmail.com" is
    // stored verbatim but the sign-in lookup queries "nate101h@gmail.com" and
    // fails with "User not found".
    rest.email = String(rest.email ?? "").trim().toLowerCase();

    // Hash password if provided
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await prisma.user.findUnique({ where: { email: rest.email } });
    if (existing) throwHttp(400, "User with this email already exists");

    // Use a transaction for atomicity
    const newUser = await prisma.$transaction(async (tx) => {
        // 1. Create User
        const newUser = await tx.user.create({
            data: {
                ...rest,
                password: hashedPassword,
                emailVerified: true, // Administrative creation skips verification
            },
        });

        // 2. Create Account for Better Auth (Mandatory for Login)
        await tx.account.create({
            data: {
                userId: newUser.id,
                accountId: newUser.email,
                providerId: "credential",
                password: hashedPassword,
            }
        });

        // 3. Create Library
        const library = await tx.library.create({
            data: { userId: newUser.id }
        });

        // 4. Create System Settings
        const settings = await tx.system_Setting.create({
            data: { userId: newUser.id }
        });

        // 5. Initialize default misc fields
        if (DEFAULT_MISC_FIELDS.length > 0) {
            await tx.miscField.createMany({
                data: DEFAULT_MISC_FIELDS.map(f => ({
                    ...f,
                    systemSettingId: settings.id,
                    options: []
                }))
            });
        }

        // 6. Ensure DNC folder exists (System Default Folder)
        await tx.contactFolder.create({
            data: {
                name: "DNC",
                isSystem: true,
                userId: newUser.id
            }
        });

        // 6b. Ensure Trash folder exists (System Default Folder)
        await tx.contactFolder.create({
            data: {
                name: "Trash",
                isSystem: true,
                userId: newUser.id
            }
        });

        // 7. Create Twilio Sub-Account (API CALL)
        // If this fails, the entire transaction (User, Account, etc.) will ROLL BACK
        try {
            const twilioSub = await createTwilioSubAccount(newUser.fullName || "Customer");
            
            // 8. Store Twilio credentials in an Integration record
            await tx.integration.create({
                data: {
                    systemSettingId: settings.id,
                    provider: "TWILIO",
                    credentials: {
                        accountSid: twilioSub.sid,
                        authToken: twilioSub.authToken,
                        status: twilioSub.status,
                        apiKeySid: twilioSub.apiKeySid,
                        apiKeySecret: twilioSub.apiKeySecret
                    },
                    status: "CONNECTED"
                }
            });
            
            console.log(`[UserService] Twilio sub-account integrated for user ${newUser.id}`);
        } catch (twilioError: any) {
            console.error(`[UserService] Twilio creation failed, rolling back user creation:`, twilioError.message);
            throw new Error(`Failed to provision Twilio resources: ${twilioError.message}. User creation aborted.`);
        }

        return newUser;
    }, {
        timeout: 20000 // Higher timeout for external Twilio API call
    });

    // Fire Zapier webhook AFTER transaction — non-blocking
    console.log("[Zapier] About to fire webhook for:", newUser.email)
    triggerZapierWebhook({
        event: "NEW_USER_SIGNUP",
        timestamp: new Date().toISOString(),
        user: {
            id: newUser.id,
            fullName: newUser.fullName,
            email: newUser.email,
            phone: (newUser as any).phone ?? null,
            role: newUser.role,
            plan: (newUser as any).plan ?? null,
            createdAt: newUser.createdAt,
        },
    });

    // Send payment setup email — non-blocking, passes the admin-selected planId
    sendPaymentSetupEmail(newUser, planId ?? undefined).catch(err =>
        console.error("[UserService] Failed to send payment setup email:", err?.message ?? err)
    );

    return newUser;
}

/**
 * Creates a Stripe checkout session for a manually provisioned user and sends
 * them an email with the payment link so they can enter their card details.
 */
async function getFirstAvailableStripePriceId(): Promise<string | null> {
    try {
        const products = await stripe.products.list({ active: true, limit: 10 });
        for (const product of products.data) {
            const prices = await stripe.prices.list({ product: product.id, active: true, type: "recurring", limit: 1 });
            if (prices.data.length > 0) {
                console.log(`[UserService] Auto-selected Stripe price: ${prices.data[0].id} (${product.name})`);
                return prices.data[0].id;
            }
        }
    } catch (err: any) {
        console.warn("[UserService] Could not auto-fetch Stripe price:", err?.message);
    }
    return null;
}

async function sendPaymentSetupEmail(user: { id: string; email: string; fullName: string | null }, planId?: string) {
    // 1. Use the admin-selected plan
    // 2. Fall back to env defaults
    // 3. Auto-fetch the first active Stripe price as last resort
    const trimmed = planId?.trim() || "";
    let resolvedPlanId: string | null =
        trimmed ||
        envConfig.STRIPE_PRICE_BASIC?.trim() ||
        envConfig.STRIPE_PRICE_STANDARD?.trim() ||
        null;

    if (!resolvedPlanId) {
        console.log("[UserService] No planId or env default — auto-fetching first Stripe price...");
        resolvedPlanId = await getFirstAvailableStripePriceId();
    }

    if (!resolvedPlanId) {
        console.warn("[UserService] No active Stripe prices found. Skipping payment email.");
        return;
    }

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: user.email,
        line_items: [{ price: resolvedPlanId, quantity: 1 }],
        mode: "subscription",
        subscription_data: { trial_period_days: 30 },
        success_url: `${envConfig.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${envConfig.FRONTEND_URL}/signup`,
        metadata: {
            userId: user.id,
            email: user.email,
            fullName: user.fullName || "",
            isManualProvision: "true",
        },
    });

    if (!session.url) {
        console.warn("[UserService] Stripe session URL was empty. No payment email sent.");
        return;
    }

    const displayName = user.fullName || "there";
    await sendEmail(
        user.email,
        "Complete Your Slingvo Account Setup — Payment Required",
        `
<div style="font-family: Arial, sans-serif; background:#f4f6f8; padding:20px;">
  <div style="max-width:600px; margin:auto; background:#ffffff; border-radius:10px; padding:30px; box-shadow:0 2px 10px rgba(0,0,0,0.1);">

    <div style="text-align:center; margin-bottom:20px;">
      <h1 style="color:#2c3e50; margin:0;">Slingvo</h1>
    </div>

    <p style="font-size:16px; color:#333;">Hi <strong>${displayName}</strong>,</p>

    <p style="font-size:15px; color:#555;">
      Your Slingvo account has been created by your administrator. To activate it, please complete your payment setup by clicking the button below.
    </p>

    <div style="text-align:center; margin:30px 0;">
      <a href="${session.url}"
         style="background:#FFCA06; color:#1a1a1a; padding:14px 32px; border-radius:8px; text-decoration:none; font-size:16px; font-weight:bold; display:inline-block;">
        Complete Payment Setup
      </a>
    </div>

    <p style="font-size:14px; color:#666;">
      Your account includes a <strong>30-day free trial</strong> — no charge until the trial ends. You can cancel anytime.
    </p>

    <p style="font-size:14px; color:#666;">
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <a href="${session.url}" style="color:#1D85F0; word-break:break-all;">${session.url}</a>
    </p>

    <hr style="border:none; border-top:1px solid #eee; margin:24px 0;"/>
    <p style="font-size:12px; color:#999; text-align:center;">© 2026 Slingvo. All rights reserved.</p>
  </div>
</div>
        `.trim()
    );

    console.log(`[UserService] Payment setup email sent to ${user.email} (Stripe session: ${session.id})`);
}

/**
 * Initializes a new user's account with essential records (Library, Settings, Twilio Sub-account, etc.)
 * Used primarily by the Better Auth sign-up hook for public signups.
 */
export async function initializeUserAccount(userId: string, fullName: string) {
    try {
        console.log(`[UserService] Initializing account for user: ${userId} (${fullName})`);

        // 1. Create Library if not exists
        let library = await prisma.library.findFirst({ where: { userId } });
        if (!library) {
            library = await prisma.library.create({ data: { userId } });
        }

        // 2. Create System Settings if not exists
        let settings = await prisma.system_Setting.findFirst({ where: { userId } });
        if (!settings) {
            settings = await prisma.system_Setting.create({ data: { userId } });
        }

        // 3. Initialize default misc fields
        const existingFields = await prisma.miscField.findMany({
            where: { systemSettingId: settings.id },
            select: { fieldName: true }
        });
        const existingNames = new Set(existingFields.map(f => f.fieldName.trim().toLowerCase()));
        const missingFields = DEFAULT_MISC_FIELDS.filter(f => !existingNames.has(f.fieldName.trim().toLowerCase()));
        
        if (missingFields.length > 0) {
            await prisma.miscField.createMany({
                data: missingFields.map(f => ({
                    ...f,
                    systemSettingId: settings.id,
                    options: []
                }))
            });
        }

        // 4. Ensure DNC folder exists
        const dncFolder = await prisma.contactFolder.findFirst({
            where: { userId, name: "DNC", isSystem: true }
        });
        if (!dncFolder) {
            await prisma.contactFolder.create({
                data: { name: "DNC", isSystem: true, userId }
            });
        }

        // 4b. Ensure Trash folder exists
        const trashFolder = await prisma.contactFolder.findFirst({
            where: { userId, name: "Trash", isSystem: true }
        });
        if (!trashFolder) {
            await prisma.contactFolder.create({
                data: { name: "Trash", isSystem: true, userId }
            });
        }

        // 5. Create Twilio Sub-Account if not exists
        const existingTwilio = await prisma.integration.findFirst({
            where: { systemSettingId: settings.id, provider: "TWILIO" }
        });

        if (!existingTwilio) {
            try {
                const twilioSub = await createTwilioSubAccount(fullName);
                await prisma.integration.create({
                    data: {
                        systemSettingId: settings.id,
                        provider: "TWILIO",
                        credentials: {
                            accountSid: twilioSub.sid,
                            authToken: twilioSub.authToken,
                            status: twilioSub.status,
                            apiKeySid: twilioSub.apiKeySid,
                            apiKeySecret: twilioSub.apiKeySecret
                        },
                        status: "CONNECTED"
                    }
                });
                console.log(`[UserService] Twilio sub-account integrated for user ${userId}`);
            } catch (twilioError: any) {
                console.error(`[UserService] Twilio creation failed for ${userId}:`, twilioError.message);
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error(`[UserService] Account initialization failed for user ${userId}:`, error.message);
        throw error;
    }
}

export async function getAllUsersFromDb(where: any = {}) {
    return prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
            defaultCallerId: true,
            createdById: true,
            createdBy: {
                select: {
                    id: true,
                    fullName: true,
                    role: true,
                    status: true
                }
            },
            createdUsers: true,
            userSubscriptions: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { plan: true, status: true },
            },
            billings: {
                orderBy: { date: "desc" },
                take: 1,
                select: { planName: true },
            },
            // Excluding password
        },
    });
}

export async function updateUserInDb(
    id: string,
    payload: Partial<{
        fullName: string;
        email: string;
        password: string;
        role: "AGENT" | "ADMIN" | "OWNER";
        status: "ACTIVE" | "DEACTIVATED" | "SUSPENDED" | "PENDING" | "EXPIRING_SOON";
        emailVerified: boolean;
        defaultCallerId: string;
    }>
) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throwHttp(404, "User not found");

    return prisma.user.update({
        where: { id },
        data: payload,
        select: {
            id: true,
            fullName: true,
            role: true,
            status: true,
            defaultCallerId: true,
        }
    });
}

/**
 * Updates a user's Stripe subscription to a new plan (price).
 * - If user already has an active Stripe subscription → update it in-place.
 * - If not → send a fresh payment setup email with the selected plan.
 */
export async function updateUserSubscriptionInDb(userId: string, planId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throwHttp(404, "User not found");

    // Try to find existing Stripe subscription via UserSubscription record
    const subRecord = await prisma.userSubscription.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { stripeSubscriptionId: true },
    });

    if (subRecord?.stripeSubscriptionId) {
        // Update the existing Stripe subscription to the new price
        const existing = await stripe.subscriptions.retrieve(subRecord.stripeSubscriptionId);
        const itemId = existing.items.data[0]?.id;

        if (itemId) {
            await stripe.subscriptions.update(subRecord.stripeSubscriptionId, {
                items: [{ id: itemId, price: planId }],
                proration_behavior: "always_invoice",
            });

            console.log(`[UserService] Updated Stripe subscription ${subRecord.stripeSubscriptionId} to price ${planId} for user ${userId}`);
            return { updated: true, method: "stripe_update" };
        }
    }

    // No subscription found — send a new payment setup email
    await sendPaymentSetupEmail(
        { id: user!.id, email: user!.email, fullName: user!.fullName },
        planId,
    );
    console.log(`[UserService] Sent new payment setup email to ${user!.email} with plan ${planId}`);
    return { updated: true, method: "payment_email" };
}

export async function deleteUserFromDb(id: string) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throwHttp(404, "User not found");

    await prisma.user.delete({ where: { id } });
    return true;
}

export async function deleteAllUsersFromDb() {
    // Caution: This deletes ALL users
    await prisma.user.deleteMany({});
    return true;
}