import { betterAuth, APIError } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  openAPI,
  customSession,
  createAuthMiddleware,
  admin as adminPlugin,
} from "better-auth/plugins";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { envConfig } from "./config";
import { ac, admin, agent, owner } from "./permissions";
import { newUserSignupTemp, loginAlertTemp, emailVerificationTemp, emailChangeConfirmationTemp, memberAddedTemp, welcomeTemp, accountClosedTemp, sendEmail } from "../utils/email";
import { ensureDefaultMiscFields } from "../routes/systemSettings/miscFields/service";
import { ensureDncFolder } from "../routes/contact/service";
import { initializeUserAccount, sendPaymentSetupEmail } from "../routes/user/service";
import { releaseTwilioResourcesForUser } from "../services/twilio-account.service";
import { releaseR2ResourcesForUser } from "../services/userAssetCleanup.service";
import { getUserPlanLimits } from "../services/planLimits.service";
import { validatePurchasedAgentSeat } from "../services/agentSeatBilling.service";
import { buildVerifyEmailUrl } from "../utils/verifyEmailLink";
import { buildSetPasswordUrl } from "../utils/setPasswordLink";

// Define the User type to include your custom fields
interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  role?: string | null;
  fullName?: string | null;
  status?: string | null;
  defaultCallerId?: string | null;
}

export const auth = betterAuth({
  appName: "Slingvo",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  user: {
    modelName: "User",
    fields: {
      name: "fullName",
    },
    additionalFields: {
      role: { type: "string", required: false },
      fullName: { type: "string", required: false },
      status: { type: "string", required: false },
      trialStatus: { type: "string", required: false },
      isSubscribed: { type: "boolean", required: false },
      createdById: { type: "string", required: false },
      defaultCallerId: { type: "string", required: false },
      stripeAgentSeatItemId: { type: "string", required: false },
      agentSeatMonthlyPriceCents: { type: "number", required: false },
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({
        user,
        newEmail,
        url,
      }: {
        user: AuthUser;
        newEmail: string;
        url: string;
        token: string;
      }) => {
        // better-auth's own verify-email endpoint completes the swap once
        // clicked — nothing else needs to touch the DB here. Confirmation
        // goes to the NEW address (proves ownership); the current address
        // is shown in the copy so the account owner can tell what's changing.
        await sendEmail(
          newEmail,
          "Confirm your new Slingvo email address",
          emailChangeConfirmationTemp(user.fullName ?? "there", user.email, newEmail, url),
          { userId: user.id },
        );
      },
    },
  },
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:3000/api/verified",
    "https://slingvo-be-production.up.railway.app",
    "https://slingvo.com",
    "https://app.slingvo.com",
    envConfig.BACKEND_URL!,
    ...(envConfig.FRONTEND_URL ? [envConfig.FRONTEND_URL] : []),
  ],
  emailVerification: {
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: AuthUser;
      url: string;
      token: string;
    }) => {
      // P0 fix: this previously emailed the account's plaintext password
      // under a "Your Account Details" subject and ignored the real
      // verification `url` Better Auth generated for this callback,
      // building a fake login link instead. Now actually verifies the
      // email via Better Auth's own link — no password anywhere.
      await sendEmail(
        user.email,
        "Verify your Slingvo email address",
        emailVerificationTemp(
          user.fullName ?? "there",
          user.email,
          url,
        ),
        { userId: user.id },
      );
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,

    sendResetPassword: async ({ user, url }: { user: AuthUser; url: string }) => {
      const displayName = user.fullName ?? user.email?.split("@")[0] ?? "User";
      // Better Auth generates a backend verification URL. Extract the token and
      // build a direct frontend URL so the button lands on the reset-password page.
      const token = new URL(url).searchParams.get("token");
      const resetUrl = token
        ? `${envConfig.FRONTEND_URL}/admin/create-password?token=${token}`
        : url;

      // MailerSend template "02 Password reset" (client audit: use as-is).
      // Better Auth's default reset-token TTL is 60 minutes.
      await sendEmail(
        user.email,
        "Reset Your Slingvo Password",
        "", // ignored — MailerSend renders the template
        {
          userId: user.id,
          mailerSendTemplateId: envConfig.MAILERSEND_TEMPLATE_PASSWORD_RESET,
          variables: {
            first_name: displayName.split(" ")[0],
            email: user.email,
            expiry_minutes: 60,
            reset_url: resetUrl,
          },
        },
      );
      console.log(`[Auth] Password reset email sent to ${user.email}`);
    },

    password: {
      hash: async (password: string): Promise<string> => {
        if (!password) throw new Error("Password required");
        console.log(password);
        return bcrypt.hash(password, 10);
      },
      verify: async ({
        hash,
        password,
      }: {
        hash: string;
        password: string;
      }): Promise<boolean> => {
        if (!password) return false;
        return bcrypt.compare(password, hash);
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: { enabled: false },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookies: {
      session_token: {
        attributes: {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        },
      },
    },
  },
  plugins: [
    openAPI({ disableDefaultReference: true }),
    customSession(
      async ({ user, session }: { user: AuthUser; session: any }) => {
        const displayName =
          user.fullName ?? user.email?.split("@")[0] ?? "User";
        return {
          user: {
            ...user,
            displayName,
            role: user.role,
            status: user.status,
          },
          session: {
            ...session,
            isActive: session.expiresAt
              ? new Date(session.expiresAt) > new Date()
              : false,
            role: user.role,
          },
        };
      },
    ),
    adminPlugin({
      ac,
      roles: {
        ADMIN: admin,
        AGENT: agent,
        OWNER: owner,
      },
    }),
  ],

  hooks: {
    before: createAuthMiddleware(async (ctx: any) => {
      // Update updatedAt on logout to track when the user logs out
      if (ctx.path.startsWith("/sign-out")) {
        const session = ctx.session;
        if (session?.userId) {
          await prisma.user.update({
            where: { id: session.userId },
            data: { updatedAt: new Date() },
          });
          console.log(`[Auth] User \${session.userId} logged out. updatedAt updated.`);
        }
      }

      // Tear down Twilio + R2 resources BEFORE Better Auth's admin plugin
      // deletes the user row. This is the actual code path the super-admin
      // "Delete" button hits (authClient.admin.removeUser -> POST
      // /admin/remove-user) — it does a raw prisma.user.delete() with no
      // app-level cleanup, so this is the only place to release the
      // account's Twilio numbers, close its sub-account, and delete its R2
      // files before the row (and its FK-linked data) is gone.
      if (ctx.path.startsWith("/admin/remove-user")) {
        const targetUserId = ctx.body?.userId;
        if (targetUserId) {
          const targetUser = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: { role: true, email: true, fullName: true },
          });
          // Only ADMIN accounts own a Twilio sub-account of their own.
          if (targetUser?.role === "ADMIN") {
            await releaseTwilioResourcesForUser(targetUserId).catch((err: any) =>
              console.error(`[Auth] Twilio teardown failed for user ${targetUserId} before admin delete:`, err.message)
            );
          }
          // Any role (admin or agent) can have their own recordings/profile
          // image in R2.
          await releaseR2ResourcesForUser(targetUserId).catch((err: any) =>
            console.error(`[Auth] R2 teardown failed for user ${targetUserId} before admin delete:`, err.message)
          );

          // This is the super-admin "Delete" path — unlike the custom
          // DELETE /user/:id route (deleteUserFromDb), Better Auth's own
          // remove-user endpoint does a raw prisma.user.delete() with no
          // app-level notification. QA caught this: account gone, deleted
          // user never told. Send before the row is gone (not in an `after`
          // hook — there'd be no user left to look up).
          if (targetUser?.email) {
            sendEmail(
              targetUser.email,
              "Your Slingvo account has been closed",
              accountClosedTemp(targetUser.fullName || "there", "admin"),
              { userId: targetUserId },
            ).catch((err: any) => console.error(`[Auth] Failed to send account-closed email for ${targetUserId}:`, err?.message ?? err));
          }
        }
      }

      // Enforce the owning admin's plan-configured agent-seat cap BEFORE
      // Better Auth's admin plugin creates the row. This is the actual code
      // path an admin's own "Add Agent" UI hits (authClient.admin.createUser
      // -> POST /admin/create-user) — it's a raw creation with no app-level
      // business logic, so createUserInDb's seat-cap check (which only runs
      // for the separate custom POST /user route) never runs for it.
      //
      // Past the included cap, creation is still allowed if the request
      // carries a stripeAgentSeatItemId from a just-completed POST
      // /agent-seats/purchase call — validatePurchasedAgentSeat confirms it's
      // a genuine, unconsumed overage seat this admin already paid for.
      // additionalFields on `user` persist it onto the new agent row so it
      // can never be reused for a second agent.
      if (ctx.path.startsWith("/admin/create-user")) {
        const role = ctx.body?.data?.role ?? ctx.body?.role;
        const createdById = ctx.body?.data?.createdById ?? ctx.body?.createdById;
        const stripeAgentSeatItemId = ctx.body?.data?.stripeAgentSeatItemId ?? ctx.body?.stripeAgentSeatItemId;
        if (role === "AGENT" && createdById) {
          const limits = await getUserPlanLimits(createdById);
          const seatCap = limits.maxAgentSeats ?? limits.includedAgentSeats;
          if (seatCap != null) {
            const currentAgentCount = await prisma.user.count({
              where: { createdById, role: "AGENT" },
            });
            if (currentAgentCount >= seatCap) {
              const hasPaidSeat = stripeAgentSeatItemId
                ? await validatePurchasedAgentSeat(createdById, stripeAgentSeatItemId)
                : false;
              if (!hasPaidSeat) {
                throw new APIError("FORBIDDEN", {
                  message: limits.extraAgentSeatPriceCents != null
                    ? `Your plan allows up to ${seatCap} agent seat(s). Purchase an extra seat to add more agents.`
                    : `Your plan allows up to ${seatCap} agent seat(s). Upgrade your plan to add more agents.`,
                });
              }
            }
          }
        }
      }

      if (ctx.path.includes("sign-up")) {
        const body = ctx.body;
        if (body?.role?.toLowerCase() === "owner") {
          throw new APIError("BAD_REQUEST", { message: "invalid role" });
        }
      }

      // if(ctx){
      //   console.log("ctx", ctx)
      // }
    }),

    after: createAuthMiddleware(async (ctx: any) => {
      if (ctx.path.includes("sign-up")) {
        const body = ctx.body;

        const user = await prisma.user.findUnique({
          where: { email: body.email },
        });
        if (user) {
          // Map status and role to uppercase enum values to match Prisma schema
          const mappedStatus = body.status
            ? body.status.toUpperCase().replace(/\s+/g, "_")
            : undefined;
          const mappedRole = body.role ? body.role.toUpperCase() : undefined;

          await prisma.user.update({
            where: { email: body.email },
            data: {
              emailVerified: true,
              role: mappedRole as any,
              status: mappedStatus as any,
            },
          });
        }

        // Trigger New User Signup notification for companies that have it enabled
        try {
          const companiesToNotify = await prisma.company.findMany({
            where: { newUserSignup: true, email: { not: null } },
            select: { email: true, userId: true },
          });

          if (companiesToNotify.length > 0) {
            const signupTime = new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
            const emailHtml = newUserSignupTemp(body.email, signupTime);

            // Send emails asynchronously (fire and forget)
            companiesToNotify.forEach((company) => {
              if (company.email && user) {
                sendEmail(company.email, "New User Signed Up on Slingvo", emailHtml, { userId: company.userId })
                  .catch(err => console.error("Failed to send signup notification:", err));
              }
            });
          }
        } catch (error) {
          console.error("Signup notification error:", error);
        }
      }

      // The admin's own "Add Agent" UI (authClient.admin.createUser -> POST
      // /admin/create-user) is a raw Better Auth creation with no app-level
      // business logic — see the seat-cap comment on the `before` hook above.
      // That means the agent-invite email createUserInDb sends never runs
      // for this path; it's only ever fired by the separate, unused-by-the-
      // current-UI POST /api/user route. This was reported as "the agent
      // doesn't get the email" — confirmed via EmailLog: zero rows were ever
      // written for a newly created agent, meaning sendEmail() was never
      // even reached, not that it silently failed.
      if (ctx.path.startsWith("/admin/create-user")) {
        const body = ctx.body;
        const role = body?.data?.role ?? body?.role;
        const createdById = body?.data?.createdById ?? body?.createdById;

        if (role === "AGENT" && createdById && body?.email) {
          try {
            const [newUser, admin, adminCompany] = await Promise.all([
              prisma.user.findUnique({ where: { email: body.email } }),
              prisma.user.findUnique({
                where: { id: createdById },
                select: { id: true, email: true, fullName: true },
              }),
              prisma.company.findFirst({ where: { userId: createdById }, select: { companyName: true } }),
            ]);

            // This `after` hook runs unconditionally — including when
            // admin.createUser actually failed (e.g. duplicate email).
            // In that case the findUnique above resolves to the
            // PRE-EXISTING account, not a fresh one, and without this
            // guard we'd send an invite/notification for an agent that
            // was never actually added (client report: admin gets the
            // "member added" email, but the agent never appears in the
            // list). Only proceed if this row both belongs to this admin
            // AND was created within this request's lifetime — a genuine
            // pre-existing account fails one or both checks.
            const justCreated =
              newUser &&
              newUser.createdById === createdById &&
              Date.now() - new Date(newUser.createdAt).getTime() < 15_000;

            if (newUser && justCreated) {
              // Switched to MailerSend dashboard-hosted template
              // "01 Welcome / Agent invite" (client audit: use as-is).
              // The template expects a plaintext temp_password + an
              // activate_url that flips emailVerified=true and lands the
              // user on the login page.
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
                    temp_password: body.password || "",
                    company_name: adminCompany?.companyName || "your workspace",
                    activate_url: buildVerifyEmailUrl(newUser.email),
                  },
                },
              ).catch((err: any) => console.error("[Auth] Failed to send agent invite email:", err?.message ?? err));

              if (admin) {
                sendEmail(
                  admin.email,
                  "New team member added to your Slingvo workspace",
                  memberAddedTemp(admin.fullName || "there", newUser.fullName || newUser.email, newUser.email),
                  { userId: admin.id },
                ).catch((err: any) => console.error("[Auth] Failed to send member-added email:", err?.message ?? err));
              }
            }
          } catch (err: any) {
            console.error("[Auth] Failed to send agent invite/member-added emails:", err?.message ?? err);
          }
        } else if (role && role !== "AGENT" && body?.email) {
          // Non-agent (ADMIN/OWNER) created manually via this same UI/endpoint —
          // same gap as the agent case: createUserInDb's welcome + payment-setup
          // email never runs here either, since this path bypasses that function
          // entirely.
          try {
            const newUser = await prisma.user.findUnique({ where: { email: body.email } });
            // Same "after hook runs even on failure" issue as the agent
            // branch above — a duplicate-email rejection would otherwise
            // re-fetch the pre-existing account and email it a fresh
            // welcome/set-password link. createdById isn't reliably present
            // for this branch (e.g. an OWNER self-provisioning an admin), so
            // recency alone is the guard here.
            const justCreated = newUser && Date.now() - new Date(newUser.createdAt).getTime() < 15_000;
            if (newUser && justCreated) {
              // No preemptive emailVerified=true here anymore — the set-password
              // link flips it as part of the flow. Better Auth's
              // requireEmailVerification then blocks direct password login until
              // the user has actually completed setup.
              sendEmail(
                newUser.email,
                "Welcome to Slingvo - Set your password",
                welcomeTemp(newUser.email, buildSetPasswordUrl(newUser.email, newUser.password)),
                { userId: newUser.id },
              ).catch((err: any) => console.error("[Auth] Failed to send welcome email:", err?.message ?? err));

              const planId = body?.data?.planId ?? body?.planId;
              sendPaymentSetupEmail(newUser, planId ?? undefined).catch((err: any) =>
                console.error("[Auth] Failed to send payment setup email:", err?.message ?? err)
              );
            }
          } catch (err: any) {
            console.error("[Auth] Failed to send welcome/payment-setup emails:", err?.message ?? err);
          }
        }
      }

      if (ctx.path.startsWith("/sign-in") || ctx.path.startsWith("/callback")) {
        const resp = ctx.context.returned as any;
        if (!resp || !resp.user?.email) return resp;

        // Update last login
        await prisma.user.update({
          where: { email: resp.user.email },
          data: { lastLogin: new Date() },
        });

        // Fetch additional user data
        const userFromDb = await prisma.user.findUnique({
          where: { email: resp.user.email },
          select: { role: true, fullName: true, status: true, defaultCallerId: true },
        });

        if (!userFromDb) return resp;

        if (userFromDb.status === "SUSPENDED") {
          throw new APIError("FORBIDDEN", {
            message: "Account suspended. Contact support.",
          });
        }

        const combinedResp = {
          ...resp,
          user: {
            ...resp.user,
            role: userFromDb.role ?? null,
            fullName: userFromDb.fullName ?? null,
            status: userFromDb.status ?? null,
            defaultCallerId: userFromDb.defaultCallerId ?? null,
          },
          session: {
            ...resp.session,
            role: userFromDb.role ?? null,
          },
        };

        // Trigger Login Alert notification for companies that have it enabled
        try {
          const companiesToNotify = await prisma.company.findMany({
            where: { loginAlerts: true, email: { not: null } },
            select: { email: true, userId: true },
          });

          if (companiesToNotify.length > 0) {
            const loginTime = new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
            const emailHtml = loginAlertTemp(resp.user.email, loginTime);

            // Send emails asynchronously (fire and forget)
            companiesToNotify.forEach((company) => {
              if (company.email) {
                sendEmail(company.email, "User Logged into Slingvo", emailHtml, { userId: company.userId })
                  .catch(err => console.error("Failed to send login alert:", err));
              }
            });
          }
        } catch (error) {
          console.error("Login notification error:", error);
        }

        return combinedResp;
      }

      if (ctx.path.startsWith("/sign-up")) {
        const resp = ctx.context.returned as any;
        if (resp?.user?.id) {
          try {
            // Use the unified initialization service which now includes Twilio sub-account creation
            await initializeUserAccount(resp.user.id, resp.user.fullName || resp.user.name || "Customer");
          } catch (error) {
            console.error("[AuthHook] User initialization failed:", error);
          }
        }
      }

      return ctx.context.returned;
    }),
  },

  secret: envConfig.BETTER_AUTH_SECRET,
  baseURL: envConfig.BETTER_AUTH_URL,

  onAPIError: {
    throw: true,
    onError: async (error, ctx: any) => {
      // Log error for debugging but let standard auth errors pass through
      console.error("Better-Auth API Error:", (error as any).message);
    },
  },
});
