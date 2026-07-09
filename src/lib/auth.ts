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
import { newUserSignupTemp, loginAlertTemp, sendEmail } from "../utils/email";
import { ensureDefaultMiscFields } from "../routes/systemSettings/miscFields/service";
import { ensureDncFolder } from "../routes/contact/service";
import { initializeUserAccount } from "../routes/user/service";
import { releaseTwilioResourcesForUser } from "../services/twilio-account.service";
import { releaseR2ResourcesForUser } from "../services/userAssetCleanup.service";
import { getUserPlanLimits } from "../services/planLimits.service";

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

const pendingPasswords = new Map<string, string>();

export const auth = betterAuth({
  appName: "Boilerplate",
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
      const data = await sendEmail(
        user.email,
        "Welcome to CallScout – Your Account Details",
        `
  <div style="font-family: Arial, sans-serif; background-color: #f4f6f8; padding: 20px;">
    <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
      
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #2c3e50; margin: 0;">CallScout</h1>
      </div>

      <p style="font-size: 16px; color: #333;">
        Hello <strong>${user.fullName ?? "User"}</strong>,
      </p>

      <h2 style="color: #28a745; margin-top: 20px;">
        Welcome to CallScout!
      </h2>

      <p style="font-size: 15px; color: #555;">
        Your account has been successfully created. Below are your login details:
      </p>

      <div style="background: #f8f9fa; border: 2px dashed #28a745; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 15px;">
          <strong>Email:</strong> ${user.email}
        </p>
        <p style="margin: 5px 0; font-size: 15px;">
          <strong>Password:</strong> ${pendingPasswords.get(user.email.toLowerCase()) || "Undefined (Wait for console log)"}
        </p>
      </div>

      <p style="font-size: 14px; color: #666;">
        Please login and change your password after your first login.
      </p>

      <p style="font-size: 12px; color: #999; text-align: center; margin-top: 30px;">
        © 2026 CallScout. All rights reserved.
      </p>

    </div>
  </div>
  `,
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
      await sendEmail(
        user.email,
        "Reset Your Slingvo Password",
        `
<div style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px;">
  <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;padding:30px;box-shadow:0 2px 10px rgba(0,0,0,.1);">
    <div style="text-align:center;margin-bottom:20px;">
      <h1 style="color:#2c3e50;margin:0;">Slingvo</h1>
    </div>
    <p style="font-size:16px;color:#333;">Hi <strong>${displayName}</strong>,</p>
    <p style="font-size:15px;color:#555;">
      We received a request to reset the password for your account (<strong>${user.email}</strong>).
      Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
    </p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${resetUrl}"
         style="background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;
                text-decoration:none;font-size:16px;font-weight:bold;display:inline-block;">
        Reset Password
      </a>
    </div>
    <p style="font-size:14px;color:#666;">
      If you didn't request a password reset, you can safely ignore this email — your password will not change.
    </p>
    <p style="font-size:14px;color:#666;">
      Or copy and paste this link into your browser:<br/>
      <a href="${resetUrl}" style="color:#1D85F0;word-break:break-all;">${resetUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
    <p style="font-size:12px;color:#999;text-align:center;">© 2026 Slingvo. All rights reserved.</p>
  </div>
</div>`,
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
            select: { role: true },
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
        }
      }

      // Enforce the owning admin's plan-configured agent-seat cap BEFORE
      // Better Auth's admin plugin creates the row. This is the actual code
      // path an admin's own "Add Agent" UI hits (authClient.admin.createUser
      // -> POST /admin/create-user) — it's a raw creation with no app-level
      // business logic, so createUserInDb's seat-cap check (which only runs
      // for the separate custom POST /user route) never runs for it.
      if (ctx.path.startsWith("/admin/create-user")) {
        const role = ctx.body?.data?.role ?? ctx.body?.role;
        const createdById = ctx.body?.data?.createdById ?? ctx.body?.createdById;
        if (role === "AGENT" && createdById) {
          const limits = await getUserPlanLimits(createdById);
          const seatCap = limits.maxAgentSeats ?? limits.includedAgentSeats;
          if (seatCap != null) {
            const currentAgentCount = await prisma.user.count({
              where: { createdById, role: "AGENT" },
            });
            if (currentAgentCount >= seatCap) {
              throw new APIError("FORBIDDEN", {
                message: `Your plan allows up to ${seatCap} agent seat(s). Upgrade your plan to add more agents.`,
              });
            }
          }
        }
      }

      // Capture plain password for the email hook
      if (ctx.path.includes("sign-up")) {
        const body = ctx.body;
        if (body?.role?.toLowerCase() === "owner") {
          throw new APIError("BAD_REQUEST", { message: "invalid role" });
        }
        if (body?.email && body?.password) {
          console.log(`[Auth] Captured password for \${body.email}`);
          pendingPasswords.set(body.email.toLowerCase(), body.password);
        }
      }

      // if(ctx){
      //   console.log("ctx", ctx)
      // }
    }),

    after: createAuthMiddleware(async (ctx: any) => {
      // Cleanup password store after request
      if (ctx.path.includes("sign-up")) {
        const body = ctx.body;

        if (body?.email) {
          setTimeout(
            () => pendingPasswords.delete(body.email.toLowerCase()),
            10000,
          );
        }

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
            select: { email: true },
          });

          if (companiesToNotify.length > 0) {
            const signupTime = new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
            const emailHtml = newUserSignupTemp(body.email, signupTime);

            // Send emails asynchronously (fire and forget)
            companiesToNotify.forEach((company) => {
              if (company.email && user) {
                sendEmail(company.email, "New User Signed Up on CallScout", emailHtml)
                  .catch(err => console.error("Failed to send signup notification:", err));
              }
            });
          }
        } catch (error) {
          console.error("Signup notification error:", error);
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
            select: { email: true },
          });

          if (companiesToNotify.length > 0) {
            const loginTime = new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
            const emailHtml = loginAlertTemp(resp.user.email, loginTime);

            // Send emails asynchronously (fire and forget)
            companiesToNotify.forEach((company) => {
              if (company.email) {
                sendEmail(company.email, "User Logged into CallScout", emailHtml)
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
