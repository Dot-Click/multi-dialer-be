import { Router } from "express";
import { protectRoute, checkRole } from "../../middlewares/auth.middleware";
import {
  submitOnboarding,
  refreshStatus,
  backfillAssignments,
  getStatus,
  CnamAttributes,
} from "../../services/cnam.service";

const router = Router();

router.use(protectRoute, checkRole(["ADMIN", "OWNER"]));

/**
 * GET /api/cnam/status
 * Returns the current CNAM enrolment state, including blocked-* statuses
 * that tell the UI which prerequisite is missing (plan, VI, business
 * profile, or subaccount).
 */
router.get("/status", async (req: any, res) => {
  try {
    const status = await getStatus(req.user.id);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * POST /api/cnam/onboard
 * Runs the CNAM Trust Hub sequence. Body: { displayName, useCase?, notes? }
 * Idempotent-ish: repeated calls upsert the integration row and resume.
 */
router.post("/onboard", async (req: any, res) => {
  try {
    const attrs = req.body as CnamAttributes;
    if (!attrs?.displayName || !attrs.displayName.trim()) {
      res.status(400).json({ message: "displayName is required." });
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
