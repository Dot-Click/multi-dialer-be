import { Request, Response } from "express";
import { envConfig } from "../../lib/config";
import {
  generateAuthUrl,
  handleOAuthCallback,
  getCalendarSyncStatus,
  disconnectProvider,
} from "./service";
import { successResponse, errorResponse } from "../../utils/handler";

const FRONTEND_URL = () => envConfig.FRONTEND_URL || "http://localhost:5000";
const SETTINGS_ROUTE = "/admin/system-settings";

export const getGoogleAuthUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) {
      errorResponse(res, "Google Calendar integration is not configured on this server.", 501);
      return;
    }
    const { id: userId } = req.user!;
    const timezone = typeof req.query.timezone === "string" ? req.query.timezone : "UTC";
    const url = generateAuthUrl(userId, timezone);
    successResponse(res, 200, "Auth URL generated", { url });
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const handleGoogleCallback = async (req: Request, res: Response): Promise<void> => {
  const base = `${FRONTEND_URL()}${SETTINGS_ROUTE}`;
  try {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    if (error) {
      console.warn("[CalSync] Google OAuth denied:", error);
      res.redirect(`${base}?calendar_sync=error&reason=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${base}?calendar_sync=error&reason=missing_params`);
      return;
    }

    await handleOAuthCallback(code, state);
    res.redirect(`${base}?calendar_sync=google_connected`);
  } catch (error: any) {
    console.error("[CalSync] Google callback error:", error.message);
    res.redirect(`${base}?calendar_sync=error&reason=${encodeURIComponent(error.message)}`);
  }
};

export const getSyncStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    const status = await getCalendarSyncStatus(userId);
    successResponse(res, 200, "Calendar sync status", status);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const disconnectCalendar = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    const { provider } = req.params as { provider: string };

    const validProviders = ["GOOGLE", "OUTLOOK"] as const;
    type ValidProvider = typeof validProviders[number];
    const p = provider.toUpperCase() as ValidProvider;

    if (!(validProviders as readonly string[]).includes(p)) {
      errorResponse(res, "Invalid provider. Use GOOGLE or OUTLOOK", 400);
      return;
    }

    await disconnectProvider(userId, p);
    successResponse(res, 200, `${p} calendar disconnected`);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
