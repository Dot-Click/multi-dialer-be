import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { openAPI, customSession, createAuthMiddleware, admin as adminPlugin } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { envConfig } from "./config";
import { ac, admin, agent, owner } from "./permissions";
import { sendEmail } from "../utils/email";
import { errorResponse } from "@/utils/handler";
import { Console } from "console";

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
    },
  },
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:3000/api/verified",
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
      const data =
        await sendEmail(
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
  `
        );
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,

    password: {
      hash: async (password: string): Promise<string> => {
        if (!password) throw new Error("Password required");
        console.log(password)
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
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
        },
      },
    },
  },
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
      // Capture plain password for the email hook
      if (ctx.path.includes("sign-up")) {
        const body = ctx.body;
        if (body?.email && body?.password) {
          console.log(`[Auth] Captured password for ${body.email}`);
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
          setTimeout(() => pendingPasswords.delete(body.email.toLowerCase()), 10000);
        }
        const user = await prisma.user.findUnique({
          where: { email: body.email },
        });
        if (user) {
          await prisma.user.update({
            where: { email: body.email },
            data: { emailVerified: true, role: body.role },
          });
        }
        console.log("User email verified successfully", user);
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
          select: { role: true, fullName: true, status: true },
        });

        if (!userFromDb) return resp;

        return {
          ...resp,
          user: {
            ...resp.user,
            role: userFromDb.role ?? null,
            fullName: userFromDb.fullName ?? null,
            status: userFromDb.status ?? null,
          },
          session: {
            ...resp.session,
            role: userFromDb.role ?? null,
          },
        };
      }

      if (ctx.path.startsWith("/sign-up")) {
        const resp = ctx.context.returned as any;
        if (resp?.user?.id) {
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

  secret: envConfig.BETTER_AUTH_SECRET,
  baseURL: envConfig.BETTER_AUTH_URL,

  onAPIError: {
    throw: true,
    onError: async (error, ctx: any) => {
      // Log error for debugging but let standard auth errors pass through
      console.error("Better-Auth API Error:", (error as any).message);
    }
  }
});
