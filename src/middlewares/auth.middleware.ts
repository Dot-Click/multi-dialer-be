import { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { auth } from "../lib/auth";
import { errorResponse } from "../utils/handler";



type User = {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
  image: string | null;
  emailVerified: boolean;
  createdById: string | null;
  trialStatus: string;
  isSubscribed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

declare global {
  namespace Express {
    interface Request {
      user?: User;
      apiClient?: { id: string; role: string };
    }
  }
}

export const protectRoute = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authorizationHeader = req.headers["authorization"];
    const apiKeyHeader = req.headers["x-api-key"];

    // 1️⃣ Bearer Token Check
    if (authorizationHeader?.startsWith("Bearer ")) {
      const token = authorizationHeader.substring(7);
      const user = await prisma.user.findFirst({
        where: {
          sessions: { some: { token } },
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          image: true,
          emailVerified: true,
          trialStatus: true,
          isSubscribed: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (user) {
        req.user = user as User;
        return next();
      }
    }

    if (typeof apiKeyHeader === "string" && apiKeyHeader.length > 0) {
      const user = await prisma.user.findUnique({
        where: { id: apiKeyHeader },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          image: true,
          emailVerified: true,
          createdById: true,
          trialStatus: true,
          isSubscribed: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (user) {
        req.user = user;
        return next();
      }
    }

    const headers = new Headers();
    if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
    if (req.headers["user-agent"])
      headers.set("user-agent", req.headers["user-agent"]);

    const session = await auth.api.getSession({ headers });

    if (session?.user?.id) {
      const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          image: true,
          emailVerified: true,
          trialStatus: true,
          isSubscribed: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (dbUser) {
        req.user = dbUser as User;
        return next();
      }
    }

    errorResponse(
      res,
      {
        message:
          "You must be logged in or provide valid API credentials to access this resource.",
      },
      401
    );
  } catch (error) {
    console.error("Authentication error:", error);
    errorResponse(res, "An internal error occurred during authentication.", 500);
  }
};


export const checkRole = (reqRoles: string[]): any => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role: string = req?.user?.role || ''
      if (!role) {
        return errorResponse(res, "You don't have permission to access this resource. Required roles: " + reqRoles.join(", "), 403)
      }
      if (!reqRoles.includes(role)) {
        return errorResponse(res, "You don't have permission to access this resource. Required roles: " + reqRoles.join(", "), 403)
      }
      return next()
    } catch (error: any) {
      console.log("error", error);
      return errorResponse(res, error.message, 500)
    }
  }
}