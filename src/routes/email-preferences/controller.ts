import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { getPreferences, updatePreferences } from "./service";

export const getEmailPreferences = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const prefs = await getPreferences(userId);
    successResponse(res, 200, "Email preferences fetched", prefs);
  } catch (err: any) {
    errorResponse(res, err?.message || "Internal server error", 500);
  }
};

export const updateEmailPreferences = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { trialReminders, inactivityNudges, marketingEmails } = req.body;

    const payload: Record<string, boolean> = {};
    if (typeof trialReminders   === "boolean") payload.trialReminders   = trialReminders;
    if (typeof inactivityNudges === "boolean") payload.inactivityNudges = inactivityNudges;
    if (typeof marketingEmails  === "boolean") payload.marketingEmails  = marketingEmails;

    const prefs = await updatePreferences(userId, payload);
    successResponse(res, 200, "Email preferences updated", prefs);
  } catch (err: any) {
    errorResponse(res, err?.message || "Internal server error", 500);
  }
};
