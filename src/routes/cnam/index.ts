import { Router } from "express";
import { protectRoute, checkRole } from "../../middlewares/auth.middleware";
import {
  submitOnboarding,
  refreshStatus,
  backfillAssignments,
  getStatus,
  CnamAttributes,
  CnamCredentials,
} from "../../services/cnam.service";

const router = Router();

router.use(protectRoute, checkRole(["ADMIN", "OWNER"]));

/**
 * GET /api/cnam/status
 * Returns the current CNAM enrolment state, including blocked-* statuses
 * that tell the UI which prerequisite is missing (plan, VI, business
 * profile, or subaccount). Auto-syncs from Twilio so the UI never shows a
 * stale rejection reason after Twilio has ruled. Best-effort — a Twilio
 * outage falls back to the DB state.
 */
router.get("/status", async (req: any, res) => {
  try {
    const userId = req.user.id;
    let status: CnamCredentials;
    try {
      status = await refreshStatus(userId);
    } catch (err: any) {
      console.warn(`[CNAM] refreshStatus for ${userId} failed:`, err?.message);
      status = await getStatus(userId);
    }
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * POST /api/cnam/onboard
 * Runs the Branded Calling Trust Hub sequence.
 * Body: {
 *   displayName, longDisplayName, callPurposeCode, callReason, logoName,
 *   notificationEmail, statusCallbackUrl?, consent
 * }
 * Idempotent-ish: repeated calls upsert the integration row and resume.
 * Service layer does the detailed field validation; the route only checks
 * the cheap "did the client send it at all" gate + consent.
 */
router.post("/onboard", async (req: any, res) => {
  try {
    const attrs = req.body as CnamAttributes;
    const required: (keyof CnamAttributes)[] = [
      "displayName", "longDisplayName", "callPurposeCode",
      "callReason", "logoName", "notificationEmail",
    ];
    for (const field of required) {
      const v = (attrs as any)?.[field];
      if (!v || (typeof v === "string" && !v.trim())) {
        res.status(400).json({ message: `${field} is required.` });
        return;
      }
    }
    if (!attrs?.consent) {
      res.status(400).json({
        message: "You must certify that the business is the caller of record to enable Branded Calling.",
      });
      return;
    }
    const result = await submitOnboarding(req.user.id, attrs);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * POST /api/cnam/refresh — polls Twilio for the trust product's latest review
 * status and mirrors it locally. On approval, flips cnamRegistered=true on
 * every assigned CallerId.
 */
router.post("/refresh", async (req: any, res) => {
  try {
    const status = await refreshStatus(req.user.id);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * POST /api/cnam/backfill — enrol the admin's already-owned numbers into
 * their approved trust product. Used after approval to catch up on numbers
 * bought during the review window.
 */
router.post("/backfill", async (req: any, res) => {
  try {
    const result = await backfillAssignments(req.user.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
