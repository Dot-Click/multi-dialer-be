import { Router } from "express";
import { protectRoute } from "../../middlewares/auth.middleware";
import { a2pRegistrationService } from "../../services/a2pRegistrationService";
import prisma from "../../lib/prisma";
import { decryptEIN } from "../../utils/encryption";

const router = Router();

/**
 * POST /api/a2p/submit
 * Submits business details for A2P registration.
 */
router.post("/submit", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
        const details = req.body;
        
        const result = await a2pRegistrationService.submitA2PRegistration(userId, details);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * GET /api/a2p/status
 * Returns current A2P status for the logged-in user. Kicks off a Twilio
 * status sync first so the UI never shows stale "pending" when Twilio has
 * already made a decision (customer profile or brand rejection). Sync is
 * best-effort — if Twilio is unreachable we still return the DB state.
 */
router.get("/status", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
        await a2pRegistrationService.checkA2PStatus(userId).catch((err: any) =>
            console.warn(`[A2P] checkA2PStatus for ${userId} failed:`, err?.message)
        );
        const registration = await prisma.a2P_Registration.findUnique({
            where: { userId },
            select: { status: true, rejectionReason: true }
        });

        res.json(registration || { status: "NOT_STARTED" });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * GET /api/a2p/details
 * Returns the previously-submitted A2P business details so the frontend
 * can prefill the form for editing on resubmit. EIN is decrypted here
 * so the admin sees what they submitted; every other field is stored
 * plaintext already.
 * Returns null when the admin has never submitted A2P.
 */
router.get("/details", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
        const reg = await prisma.a2P_Registration.findUnique({
            where: { userId },
            select: {
                legalBusinessName: true,
                businessType: true,
                ein: true,
                businessWebsite: true,
                businessAddress: true,
                city: true,
                state: true,
                postalCode: true,
                country: true,
                contactFirstName: true,
                contactLastName: true,
                contactEmail: true,
                contactPhone: true,
            },
        });
        if (!reg) {
            res.json(null);
            return;
        }
        // Best-effort decrypt — if the stored value was written with a
        // different key or corrupted, fall back to empty so the admin
        // can re-enter their EIN rather than seeing gibberish.
        let einPlain = "";
        try { einPlain = decryptEIN(reg.ein); } catch { einPlain = ""; }
        res.json({ ...reg, ein: einPlain });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * POST /api/a2p/webhook
 * Twilio status callbacks.
 */
router.post("/webhook", async (req, res) => {
    console.log("[A2P Webhook] Received:", JSON.stringify(req.body, null, 2));
    // Implementation for handling Twilio's Brand/Campaign status callbacks
    res.status(200).send("OK");
});

export default router;
