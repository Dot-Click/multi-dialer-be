import { Router } from "express";
import { protectRoute } from "../../middlewares/auth.middleware";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  getOutlookAuthUrl,
  handleOutlookCallback,
  getSyncStatus,
  disconnectCalendar,
} from "./controller";

const router = Router();

router.get("/auth/google/url", protectRoute, getGoogleAuthUrl);
router.get("/auth/google/callback", handleGoogleCallback);

router.get("/auth/outlook/url", protectRoute, getOutlookAuthUrl);
router.get("/auth/outlook/callback", handleOutlookCallback);

router.get("/status", protectRoute, getSyncStatus);
router.delete("/:provider", protectRoute, disconnectCalendar);

export default router;
