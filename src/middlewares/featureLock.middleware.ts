import { Request, Response, NextFunction } from "express";
import { errorResponse } from "../utils/handler";
import { getEffectiveLock } from "../utils/status";

/**
 * Middleware to block access to restricted features for expired trials.
 */
export const checkFeatureLocked = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;

    if (!user) {
      errorResponse(res, "Authentication required", 401);
      return
    }

    const { locked } = await getEffectiveLock(user.id);
    if (locked) {
      errorResponse(
        res,
        {
          code: "FEATURE_LOCKED",
          message: "Upgrade your plan to access this feature",
        },
        403
      );
      return 
    }

    next();
  } catch (error) {
    console.error("Feature lock check error:", error);
    next(error);
  }
};
