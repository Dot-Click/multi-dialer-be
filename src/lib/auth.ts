import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { openAPI, customSession, createAuthMiddleware } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { envConfig } from "./config";
import { sendEmail } from "../utils/email";

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
}

export const auth = betterAuth({
  appName: "Boilerplate",

  /* ================= DATABASE ================= */
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  /* ================= USER MODEL ================= */
  user: {
    modelName: "User",
    additionalFields: {
      role: { type: "string", required: false },
      fullName: { type: "string", required: false },
      status: { type: "string", required: false },
    },
  },

  /* ================= ORIGINS ================= */
  trustedOrigins: [
    "http://localhost:3000",
    ...(envConfig.FRONTEND_URL ? [envConfig.FRONTEND_URL] : []),
  ],

  /* ================= EMAIL VERIFY ================= */
  emailVerification: {
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { email: string; fullName?: string | null };
      url: string;
    }) => {
      await sendEmail(
        user.email,
        "Verify your email",
        `<p>Hello ${user.fullName ?? "User"}</p>
         <p>Click below to verify your email</p>
         <a href="${url}">Verify Email</a>`
      );
    },
  },

  /* ================= EMAIL + PASSWORD ================= */
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,

    password: {
      hash: async (password: string): Promise<string> => {
        if (!password) throw new Error("Password required");
        return bcrypt.hash(password, 10);
      },
      verify: async ({
        hash,
        password,
      }: {
        hash: string;
        password: string;
      }): Promise<boolean> => {
        if (!password) throw new Error("Password required");
        const match = await bcrypt.compare(password, hash);
        if (!match) throw new Error("Invalid credentials");
        return true;
      },
    },
  },

  /* ================= SESSION ================= */
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: { enabled: false },
  },

  /* ================= COOKIES ================= */
  advanced: {
    useSecureCookies: true,
    cookies: {
      session_token: {
        attributes: { httpOnly: true, secure: true, sameSite: "none" },
      },
    },
  },

  /* ================= PLUGINS ================= */
  plugins: [
    openAPI({ disableDefaultReference: true }),
    customSession(async ({ user, session }: { user: AuthUser; session: any }) => {
      const displayName = user.fullName ?? user.email?.split("@")[0] ?? "User";
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
    }),
  ],

  /* ================= HOOKS ================= */
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith("/sign-in") || ctx.path.startsWith("/callback")) {
        const resp = (ctx.context.returned ?? ctx.context.response) as any;
        if (!resp || !resp.user?.email) return resp;

        // Update last login
        await prisma.user.update({
          where: { email: resp.user.email },
          data: { lastLogin: new Date() },
        });

        const userFromDb = await prisma.user.findFirst({
          where: { email: resp.user.email },
        });

        return {
          ...resp,
          user: {
            ...resp.user,
            role: userFromDb?.role ?? null,
            fullName: userFromDb?.fullName ?? null,
            status: userFromDb?.status ?? null,
          },
          session: {
            ...resp.session,
            role: userFromDb?.role ?? null,
          },
        };
      }

      if (ctx.path.startsWith("/sign-up")) {
        const resp = (ctx.context.returned ?? ctx.context.response) as any;
        if (resp?.user?.id) {
          // Handle user setup logic that was in onUserCreate
          try {
            const library = await prisma.library.findFirst({ where: { userId: resp.user.id } });
            if (!library) await prisma.library.create({ data: { userId: resp.user.id } });

            const settings = await prisma.system_Setting.findFirst({ where: { userId: resp.user.id } });
            if (!settings) await prisma.system_Setting.create({ data: { userId: resp.user.id } });
          } catch (error) {
            console.error("User setup failed", error);
          }
        }
      }

      return ctx.context.returned;
    }),
  },




  /* ================= ENV ================= */
  secret: envConfig.BETTER_AUTH_SECRET,
  baseURL: envConfig.BETTER_AUTH_URL,
});
