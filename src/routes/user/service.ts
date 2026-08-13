import bcrypt from "bcryptjs";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount, releaseTwilioResourcesForUser } from "../../services/twilio-account.service";
import { releaseR2ResourcesForUser } from "../../services/userAssetCleanup.service";
import { getUserPlanLimits } from "../../services/planLimits.service";
import { validatePurchasedAgentSeat } from "../../services/agentSeatBilling.service";
import { subscriptionIdFromInvoice } from "../../services/billingLedger.service";
import { DEFAULT_MISC_FIELDS } from "../systemSettings/miscFields/defaults";
import { triggerZapierWebhook } from "../../lib/zapier";
import { sendEmail, welcomeTemp, memberAddedTemp, roleChangedTemp, emailChangedByAdminTemp, accountClosedTemp } from "../../utils/email";
import { emailShell, emailParagraph } from "../../utils/emailShell";
import { envConfig } from "../../lib/config";
import { buildSetPasswordUrl } from "../../utils/setPasswordLink";
import { buildVerifyEmailUrl } from "../../utils/verifyEmailLink";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: "2026-04-22.dahlia",
});

function throwHttp(statusCode: number, message: string): never {
    throw { message, statusCode };
}

export async function createUserInDb(payload: any) {
    const { password, planId, companyName, ...rest } = payload;

    // Normalize the email the same way Better Auth does at sign-in (lowercased +
    // trimmed). Without this, a mixed-case email like "Nate101h@gmail.com" is
    // stored verbatim but the sign-in lookup queries "nate101h@gmail.com" and
    // fails with "User not found".
    rest.email = String(rest.email ?? "").trim().toLowerCase();

    // Hash password if provided
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await prisma.user.findUnique({ where: { email: rest.email } });
    if (existing) throwHttp(400, "User with this email already exists");

    // Enforce the owning admin's plan-configured agent-seat cap. Past the
    // included cap, creation is still allowed if `rest.stripeAgentSeatItemId`
    // is a genuine, unconsumed overage seat already paid for via POST
    // /agent-seats/purchase (validatePurchasedAgentSeat) — it gets persisted
    // onto the new row below so it can't be reused for a second agent.
    if (rest.role === "AGENT" && rest.createdById) {
        const limits = await getUserPlanLimits(rest.createdById);
        const seatCap = limits.maxAgentSeats ?? limits.includedAgentSeats;
        if (seatCap != null) {
            const currentAgentCount = await prisma.user.count({
                where: { createdById: rest.createdById, role: "AGENT" },
            });
            if (currentAgentCount >= seatCap) {
                const hasPaidSeat = rest.stripeAgentSeatItemId
                    ? await validatePurchasedAgentSeat(rest.createdById, rest.stripeAgentSeatItemId)
                    : false;
                if (!hasPaidSeat) {
                    throwHttp(403, limits.extraAgentSeatPriceCents != null
                        ? `Your plan allows up to ${seatCap} agent seat(s). Purchase an extra seat to add more agents.`
                        : `Your plan allows up to ${seatCap} agent seat(s). Upgrade your plan to add more agents.`);
                }
            }
        }
    }

    // Use a transaction for atomicity
    const newUser = await prisma.$transaction(async (tx) => {
        // 1. Create User
        //
        // emailVerified starts FALSE — the set-password link the invite email
        // carries flips it to true as part of the flow (see
        // routes/user/setPassword.ts). Previously this was set to true
        // preemptively with a "administrative creation skips verification"
        // comment, which combined with emailing the plaintext password
        // meant every admin-created account was insecure by default
        // (GA 4.0 audit finding).
        const newUser = await tx.user.create({
            data: {
                ...rest,
                password: hashedPassword,
                emailVerified: false,
            },
        });

        // 1.5 Create Company record if a company name was provided (mirrors
        // the public signup flow's checkout.session.completed provisioning)
        if (companyName) {
            await tx.company.create({
                data: {
                    companyName,
                    userId: newUser.id,
                },
            });
        }

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

    // For admin/owner welcome (non-agent branch), we still use our inline
    // template with a set-password link — MailerSend's Template Library only
    // has agent-invite/reset/removed live so far; the rest of Jason's 12
    // pre-zipped templates haven't been imported yet.
    const setPasswordUrl = buildSetPasswordUrl(newUser.email, hashedPassword);

    if (newUser.role === "AGENT" && rest.createdById) {
        // Fetch admin + their workspace name for the invite email and the
        // member-added notification in one shot.
        Promise.all([
            prisma.user.findUnique({ where: { id: rest.createdById }, select: { id: true, email: true, fullName: true } }),
            prisma.company.findFirst({ where: { userId: rest.createdById }, select: { companyName: true } }),
        ])
            .then(([admin, adminCompany]) => {
                // Agent invite → MailerSend template "01 Welcome / Agent invite".
                // Template expects a plaintext temp_password + an activate_url
                // that flips emailVerified=true and redirects to login.
                sendEmail(
                    newUser.email,
                    `You've been invited to Slingvo by ${admin?.fullName || "your admin"}`,
                    "", // ignored — MailerSend renders the template
                    {
                        userId: newUser.id,
                        mailerSendTemplateId: envConfig.MAILERSEND_TEMPLATE_WELCOME_AGENT,
                        variables: {
                            first_name: (newUser.fullName || "there").split(" ")[0],
                            inviter_name: admin?.fullName || "your admin",
                            email: newUser.email,
                            temp_password: password,
                            company_name: adminCompany?.companyName || "your workspace",
                            activate_url: buildVerifyEmailUrl(newUser.email),
                        },
                    },
                ).catch(err => console.error("[UserService] Failed to send agent invite email:", err?.message ?? err));

                // Member-added notification to the admin (still our inline
                // template — no MailerSend equivalent imported yet)
                if (admin) {
                    sendEmail(
                        admin.email,
                        "New team member added to your Slingvo workspace",
                        memberAddedTemp(admin.fullName || "there", newUser.fullName || newUser.email, newUser.email),
                        { userId: admin.id },
                    ).catch(err => console.error("[UserService] Failed to send member-added email:", err?.message ?? err));
                }
            })
            .catch(err => console.error("[UserService] Failed to fetch admin for invite emails:", err?.message ?? err));
    } else {
        sendEmail(
            newUser.email,
            "Welcome to Slingvo - Set your password",
            welcomeTemp(newUser.email, setPasswordUrl),
            { userId: newUser.id },
        ).catch(err => console.error("[UserService] Failed to send welcome email:", err?.message ?? err));

        // Payment setup email only applies to ADMIN accounts, not agents
        sendPaymentSetupEmail(newUser, planId ?? undefined).catch(err =>
            console.error("[UserService] Failed to send payment setup email:", err?.message ?? err)
        );
    }

    return newUser;
}

/**
 * Creates a Stripe checkout session for a manually provisioned user and sends
 * them an email with the payment link so they can enter their card details.
 */
export async function sendPaymentSetupEmail(user: { id: string; email: string; fullName: string | null }, planId?: string) {
    // P0 billing finding: the previous "3. Auto-fetch the first active
    // Stripe price as last resort" step silently picked whatever product
    // Stripe's API happened to list first — which sent a user the admin
    // put on $97/mo Starter a checkout link for $5,368/year Scale Yearly
    // instead. A wrong price charged is worse than a blocked request:
    // refuse to guess. If no planId was actually passed and no env
    // default is configured, this throws instead of resolving.
    const trimmed = planId?.trim() || "";
    const resolvedPlanId: string | null =
        trimmed ||
        envConfig.STRIPE_PRICE_BASIC?.trim() ||
        envConfig.STRIPE_PRICE_STANDARD?.trim() ||
        null;

    if (!resolvedPlanId) {
        throw new Error(
            `sendPaymentSetupEmail: no planId provided for ${user.email} and no STRIPE_PRICE_BASIC/STRIPE_PRICE_STANDARD env default is configured — refusing to auto-select a Stripe price.`
        );
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
        emailShell({
            title: "Complete Your Slingvo Account Setup",
            preheader: "Complete your Slingvo payment setup to activate your account.",
            badgeLabel: "Account update",
            heading: "Complete your payment setup.",
            bodyHtml:
                emailParagraph(`Hi <strong>${displayName}</strong>, your Slingvo account has been created by your administrator. To activate it, please complete your payment setup by clicking the button below.`) +
                emailParagraph(`Your account includes a <strong>30-day free trial</strong> — no charge until the trial ends. You can cancel anytime.`),
            buttonText: "Complete Payment Setup",
            buttonUrl: session.url,
            footnote: `If the button doesn't work, copy and paste this link into your browser: <a href="${session.url}" style="color:#2D5BE3;word-break:break-all;">${session.url}</a>`,
        }),
        { userId: user.id },
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
                select: { plan: true, status: true, cardBrand: true, cardLast4: true },
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
        role: "AGENT" | "ADMIN" | "OWNER";
        status: "ACTIVE" | "DEACTIVATED" | "SUSPENDED" | "PENDING" | "EXPIRING_SOON";
        emailVerified: boolean;
        defaultCallerId: string;
    }>
) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throwHttp(404, "User not found");

    const updated = await prisma.user.update({
        where: { id },
        data: payload,
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            defaultCallerId: true,
        }
    });

    // Notify the user when their role changes
    if (payload.role && payload.role !== existing.role) {
        sendEmail(
            existing.email,
            "Your Slingvo role has been updated",
            roleChangedTemp(existing.fullName || "there", existing.role, payload.role),
            { userId: id },
        ).catch(err => console.error("[UserService] Failed to send role-changed email:", err?.message ?? err));
    }

    // GA 4.0 audit finding: admin-initiated email changes previously bypassed
    // Better Auth's own change-email verification flow entirely and notified
    // no one. Now notify BOTH addresses so the user (a) knows the change
    // happened and (b) has a record of the previous address as a fallback.
    if (payload.email && payload.email !== existing.email) {
        const oldEmail = existing.email;
        const newEmail = payload.email;
        sendEmail(
            oldEmail,
            "Your Slingvo email address was changed",
            emailChangedByAdminTemp(existing.fullName || "there", oldEmail, newEmail, "old"),
            { userId: id },
        ).catch(err => console.error("[UserService] Failed to send email-change (old) notification:", err?.message ?? err));

        sendEmail(
            newEmail,
            "Your Slingvo email address was changed",
            emailChangedByAdminTemp(existing.fullName || "there", oldEmail, newEmail, "new"),
            { userId: id },
        ).catch(err => console.error("[UserService] Failed to send email-change (new) notification:", err?.message ?? err));
    }

    return updated;
}

/**
 * Updates a user's Stripe subscription to a new plan (price).
 * - If user already has an active Stripe subscription → update it in-place.
 * - If not → send a fresh payment setup email with the selected plan.
 */
export async function updateUserSubscriptionInDb(userId: string, planId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throwHttp(404, "User not found");

    // 1. Try stripeSubscriptionId directly on UserSubscription
    let stripeSubscriptionId: string | null = null;

    const subRecord = await prisma.userSubscription.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { stripeSubscriptionId: true, stripeCustomerId: true },
    });

    if (subRecord?.stripeSubscriptionId) {
        stripeSubscriptionId = subRecord.stripeSubscriptionId;
    }

    // 2. Fall back: look up the latest Billing invoice and retrieve subscription from Stripe
    if (!stripeSubscriptionId) {
        const latestBilling = await prisma.billing.findFirst({
            where: { userId, stripeInvoiceId: { not: null } },
            orderBy: { date: "desc" },
            select: { stripeInvoiceId: true },
        });
        if (latestBilling?.stripeInvoiceId) {
            const invoice = await stripe.invoices.retrieve(latestBilling.stripeInvoiceId) as any;
            stripeSubscriptionId = subscriptionIdFromInvoice(invoice);
        }
    }

    // 3. Fall back: list active subscriptions by Stripe customer ID
    if (!stripeSubscriptionId && subRecord?.stripeCustomerId) {
        const subs = await stripe.subscriptions.list({
            customer: subRecord.stripeCustomerId,
            status: "active",
            limit: 1,
        });
        stripeSubscriptionId = subs.data[0]?.id ?? null;
    }

    if (stripeSubscriptionId) {
        const existing = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const itemId = existing.items.data[0]?.id;

        if (itemId) {
            await stripe.subscriptions.update(stripeSubscriptionId, {
                items: [{ id: itemId, price: planId }],
                proration_behavior: "always_invoice",
            });
            console.log(`[UserService] Updated Stripe subscription ${stripeSubscriptionId} to price ${planId} for user ${userId}`);

            // Resolve the new plan name and update UserSubscription immediately —
            // don't rely on the webhook which may not be configured for this env.
            let newPlanName: string | null = null;
            try {
                const price = await stripe.prices.retrieve(planId, { expand: ["product"] });
                newPlanName = (price.product as any)?.name ?? null;
            } catch (e: any) {
                console.error(`[UserService] Could not resolve product name for price ${planId}:`, e.message);
            }

            if (newPlanName && subRecord) {
                await prisma.userSubscription.updateMany({
                    where: { userId, stripeCustomerId: subRecord.stripeCustomerId ?? undefined },
                    data: { plan: newPlanName, stripeSubscriptionId },
                });
                console.log(`[UserService] UserSubscription.plan updated to "${newPlanName}" for user ${userId}`);
            }

            return { updated: true, method: "stripe_update" };
        }
    }

    // 4. No active Stripe subscription found — send a payment setup email
    await sendPaymentSetupEmail(
        { id: user!.id, email: user!.email, fullName: user!.fullName },
        planId,
    );
    console.log(`[UserService] Sent new payment setup email to ${user!.email} with plan ${planId}`);
    return { updated: true, method: "payment_email" };
}

export async function deleteUserFromDb(id: string) {
    const existing = await prisma.user.findUnique({
        where: { id },
        select: { id: true, email: true, fullName: true, role: true, createdById: true },
    });
    if (!existing) throwHttp(404, "User not found");

    // GA 4.0 audit finding: deleted users got no notification of any kind.
    // Send the closed-account email BEFORE the delete so it goes out while
    // the row still exists. Deliberately do NOT tie it to userId — the user
    // is about to be deleted and EmailLog.userId cascades on delete, which
    // would wipe this log the moment the delete lands.
    try {
        await sendEmail(
            existing.email,
            "Your Slingvo account has been closed",
            accountClosedTemp(existing.fullName || "there", "admin"),
        );
    } catch (err: any) {
        console.error(`[UserService] Failed to send account-closed email to ${existing.email}:`, err?.message ?? err);
    }

    // Only ADMIN accounts own a Twilio sub-account + numbers of their own —
    // agents use their admin's, and OWNER (platform staff) have none at all.
    if (existing.role === "ADMIN") {
        await releaseTwilioResourcesForUser(id).catch((err: any) =>
            console.error(`[UserService] Twilio teardown failed for user ${id}:`, err.message)
        );
    }
    // Any role can have their own recordings/profile image in R2.
    await releaseR2ResourcesForUser(id).catch((err: any) =>
        console.error(`[UserService] R2 teardown failed for user ${id}:`, err.message)
    );

    await prisma.user.delete({ where: { id } });

    // Notify the owning admin when one of their agents is removed —
    // MailerSend template "03 Team member removed" (client audit: use as-is).
    if (existing.role === "AGENT" && existing.createdById) {
        const removedAt = new Date();
        Promise.all([
            prisma.user.findUnique({ where: { id: existing.createdById }, select: { id: true, email: true, fullName: true } }),
            prisma.company.findFirst({ where: { userId: existing.createdById }, select: { companyName: true } }),
        ])
            .then(([admin, adminCompany]) => {
                if (!admin) return;
                return sendEmail(
                    admin.email,
                    "A team member has been removed from your Slingvo workspace",
                    "", // ignored — MailerSend renders the template
                    {
                        userId: admin.id,
                        mailerSendTemplateId: envConfig.MAILERSEND_TEMPLATE_MEMBER_REMOVED,
                        variables: {
                            removed_by: admin.fullName || "An administrator",
                            company_name: adminCompany?.companyName || "your workspace",
                            member_name: existing.fullName || existing.email,
                            member_email: existing.email,
                            removed_at: removedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC",
                            manage_url: `${envConfig.FRONTEND_URL}/admin/user-management`,
                        },
                    },
                );
            })
            .catch(err => console.error("[UserService] Failed to send member-removed email:", err?.message ?? err));
    }

    return true;
}

export async function deleteAllUsersFromDb() {
    // Caution: This deletes ALL users
    const allUsers = await prisma.user.findMany({ select: { id: true, role: true } });
    for (const u of allUsers) {
        if (u.role === "ADMIN") {
            await releaseTwilioResourcesForUser(u.id).catch((err: any) =>
                console.error(`[UserService] Twilio teardown failed for user ${u.id}:`, err.message)
            );
        }
        await releaseR2ResourcesForUser(u.id).catch((err: any) =>
            console.error(`[UserService] R2 teardown failed for user ${u.id}:`, err.message)
        );
    }

    await prisma.user.deleteMany({});
    return true;
}