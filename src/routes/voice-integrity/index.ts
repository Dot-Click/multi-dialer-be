import { Router } from "express";
import { protectRoute, checkRole } from "../../middlewares/auth.middleware";
import {
  submitOnboarding,
  refreshStatus,
  backfillAssignments,
  getStatus,
  VoiceIntegrityAttributes,
} from "../../services/voiceIntegrity.service";

const router = Router();

/**
 * All Voice Integrity routes are ADMIN/OWNER scoped — agents don't own
 * Twilio subaccounts or phone numbers, so they can't enrol anything.
 */
router.use(protectRoute, checkRole(["ADMIN", "OWNER"]));

/**
 * GET /api/voice-integrity/status
 * Returns the current enrolment state for the logged-in admin.
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
 * POST /api/voice-integrity/onboard
 * Runs the 7-step Trust Hub enrolment. Body:
 *   { useCase, businessEmployeeCount, averageBusinessDayCallVolume, notes? }
 *
 * Idempotent-ish — safe to re-run if a previous attempt failed midway
 * (the service upserts the integration row and reuses the Business Profile).
 */
router.post("/onboard", async (req: any, res) => {
  try {
    const attrs = req.body as VoiceIntegrityAttributes;
    if (!attrs?.useCase || !attrs?.businessEmployeeCount || !attrs?.averageBusinessDayCallVolume) {
      res.status(400).json({
        message: "useCase, businessEmployeeCount, and averageBusinessDayCallVolume are required.",
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
 * POST /api/voice-integrity/refresh
 * Polls Twilio for the trust product's latest review status and mirrors
 * it locally. Flips voiceIntegrityRegistered=true on assigned numbers when
 * the trust product transitions to twilio-approved.
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
 * POST /api/voice-integrity/backfill
 * Enrols the admin's already-owned numbers into their trust product. Meant
 * for the moment after approval lands, or as a manual "sync" button in the
 * settings UI.
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
