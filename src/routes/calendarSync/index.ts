import { Router } from "express";
import { protectRoute } from "../../middlewares/auth.middleware";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  getSyncStatus,
  disconnectCalendar,
} from "./controller";

const router = Router();

// Returns the Google OAuth consent URL (frontend redirects to it)
router.get("/auth/google/url", protectRoute, getGoogleAuthUrl);

// Browser redirect from Google — no auth header, uses state param
router.get("/auth/google/callback", handleGoogleCallback);

// Connected provider statuses for the current user
router.get("/status", protectRoute, getSyncStatus);

// Disconnect a provider (GOOGLE | OUTLOOK)
router.delete("/:provider", protectRoute, disconnectCalendar);

export default router;
