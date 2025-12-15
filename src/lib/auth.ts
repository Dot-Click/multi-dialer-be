// import { APIError, betterAuth } from "better-auth";
// import { prismaAdapter } from "better-auth/adapters/prisma";
// import { PrismaClient } from "@prisma/client";
// import { openAPI, customSession, emailOTP, createAuthMiddleware } from "better-auth/plugins";
// import bcrypt from "bcryptjs";
// import { envConfig } from "./config";
// import { otpTemp, sendEmail } from "../utils/email";

// const prisma = new PrismaClient();
// export const auth = betterAuth({
//   appName: "Boilerplate",
//   database: prismaAdapter(prisma, {
//     provider: "postgresql", // or "mysql", "postgresql", ...etc
//   }),
//   user: {
//     modelName: "user",
//     additionalFields: {
//       role: {
//         type: "string",
//         required: false,
//       },
//     }
//   },
//   trustedOrigins: ["http://localhost:5000"],
//   verifyEmail: {
//     enabled: true,
//   },
//   socialProviders: {
//     google: {
//         prompt: "select_account",
//         clientId: envConfig.GOOGLE_CLIENT_ID as string, 
//         clientSecret: envConfig.GOOGLE_CLIENT_SECRET as string, 
//     }, 
//   },
//   emailVerification: {
//     sendVerificationEmail: async ( { user, url, token }, request) => {
//       await sendEmail(user.email, "Verify your email address", `<html>Click the link to verify your email: <a href="${url}">Link</a></html>`);
//     },
//   },
//   emailAndPassword: {
//     enabled: true,
//     requireEmailVerification: true,
//     headers: {
//       "Content-Type": "application/json",
//     },
//     password: {
//       hash: async (password) => {
//         return await bcrypt.hash(password, 10);
//       },
//       verify: async ({hash, password}) => {
//         const isValid = await bcrypt.compare(password, hash);
//         if (!isValid) {
//           throw new Error("Invalid password");
//         }
//         return isValid;
//       },
//     },
//   },
  
//   session: {
//     expiresIn: 60 * 60 * 24 * 7,
//     updateAge: 60 * 60 * 24, 
//     cookieCache: {
//       enabled: false,
//     },
//   },

//   advanced: {
//     useSecureCookies: true,
//     cookies: {
//       session_token: {
//         attributes: {
//           sameSite: "none",
//           httpOnly: true,
//           secure: true,
//         },
//       },
//     },
//   },
  
//   plugins: [
//     openAPI({
//       disableDefaultReference: true,
//     }),
//     customSession(async ({ user, session }: { user: any, session: any }) => {
//       const modifiedUser = {
//         ...user,
//         displayName: user.name || user.email?.split('@')[0] || 'User',
//         role: user.role,
//       };

//       const modifiedSession = {
//         ...session,
//         isActive: new Date(session.expiresAt) > new Date(),
//         role: user.role,
//       };

//       return {
//         user: modifiedUser,
//         session: modifiedSession,
//       };
//     }),
//   ],
//   secret: envConfig.BETTER_AUTH_SECRET,
//   baseUrl: envConfig.BETTER_AUTH_URL,
// });




import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { openAPI, customSession } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import { envConfig } from "./config";
import { sendEmail } from "../utils/email";
import prisma from "./prisma";

export const auth = betterAuth({
  appName: "Boilerplate",

  // DATABASE
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  // USER MODEL
  user: {
    modelName: "User",
    additionalFields: {
      role: {
        type: "string",
        required: false,
      },
      fullName: {
        type: "string",
        required: false,
      },
      status: {
        type: "string",
        required: false,
      },
    },
  },

  trustedOrigins: ["http://localhost:3000"],

  // EMAIL VERIFICATION
  verifyEmail: {
    enabled: true,
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Verify your email address",
        `<html>Click the link to verify your email: <a href="${url}">Verify Email</a></html>`
      );
    },
  },

  // EMAIL + PASSWORD LOGIN
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    headers: {
      "Content-Type": "application/json",
    },
    
    // Custom hook to bypass email verification for test2@example.com
    onBeforeSignIn: async ({ user }: { user: any }) => {
      if (user?.email?.toLowerCase() === "test2@example.com") {
        // Auto-verify test2@example.com before sign-in check
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        });
      }
      return { user };
    },

    password: {
      hash: async (password) => {
        if (!password) throw new Error("Password required");
        return await bcrypt.hash(password, 10);
      },

      verify: async ({ hash, password }) => {
        if (!password) throw new Error("Password required");
        const match = await bcrypt.compare(password, hash);
        if (!match) throw new Error("Invalid password");
        return match;
      },
    },
  },

  // SESSION CONFIG
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: false,
    },
  },

  // COOKIE SECURITY
  advanced: {
    useSecureCookies: true,
    cookies: {
      session_token: {
        attributes: {
          sameSite: "none",
          httpOnly: true,
          secure: true,
        },
      },
    },
  },

  // PLUGINS
  plugins: [
    openAPI({ disableDefaultReference: true }),

    customSession(async ({ user, session }) => {
      const userWithExtras = user as typeof user & { role?: string; fullName?: string };
      const modifiedUser = {
        ...user,
        displayName: userWithExtras.fullName || user.email?.split("@")[0] || "User",
        role: userWithExtras.role,
      };

      const modifiedSession = {
        ...session,
        isActive: new Date(session.expiresAt) > new Date(),
        role: userWithExtras.role,
      };

      return { user: modifiedUser, session: modifiedSession };
    }),
  ],

  // EVENTS — AUTO CREATE LIBRARY AND SYSTEMSETTINGS AFTER USER SIGNUP (Backup method)
  events: {
    onUserCreate: async ({ user }: { user: any }) => {
      console.log("🔔 Better-Auth Event: onUserCreate triggered for user:", user?.id);
      try {
        if (!user || !user.id) {
          console.error("❌ Invalid user object in onUserCreate event");
          return;
        }

        // Auto-verify email ONLY for test2@example.com
        // All other users need to verify their email normally
        if (user.email && user.email.toLowerCase() === "test2@example.com") {
          await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: true },
          });
          console.log("✅ Better-Auth Event: Test email auto-verified for User:", user.id, user.email);
        } else {
          console.log("ℹ️ Better-Auth Event: Email verification required for User:", user.id, user.email);
        }

        // Check if library already exists (avoid duplicates)
        const existingLibrary = await prisma.library.findFirst({
          where: { userId: user.id },
        });

        if (!existingLibrary) {
          // Create user library
          const newLibrary = await prisma.library.create({
            data: {
              userId: user.id,
            },
          });
          console.log("✅ Better-Auth Event: Library Created For User:", user.id, "Library ID:", newLibrary.id);
        } else {
          console.log("ℹ️ Better-Auth Event: Library already exists for User:", user.id);
        }

        // Check if systemSettings already exists (avoid duplicates)
        const existingSystemSettings = await prisma.system_Setting.findFirst({
          where: { userId: user.id },
        });

        if (!existingSystemSettings) {
    
          const newSystemSettings = await prisma.system_Setting.create({
            data: {
              userId: user.id,
            },
          });
          console.log("✅ Better-Auth Event: SystemSettings Created For User:", user.id, "SystemSettings ID:", newSystemSettings.id);
        } else {
          console.log("ℹ️ Better-Auth Event: SystemSettings already exists for User:", user.id);
        }
      } catch (err: any) {
        console.error("❌ Better-Auth Event: Library/SystemSettings Create Error:", err?.message || err);
        console.error("Error stack:", err?.stack);
          }
    },
  },

  secret: envConfig.BETTER_AUTH_SECRET,
  baseUrl: envConfig.BETTER_AUTH_URL,
});

