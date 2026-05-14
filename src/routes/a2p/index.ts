import { Router } from "express";
import { protectRoute } from "../../middlewares/auth.middleware";
import { a2pRegistrationService } from "../../services/a2pRegistrationService";
import prisma from "../../lib/prisma";

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
 * Returns current A2P status for the logged-in user.
 */
router.get("/status", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
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
 * POST /api/a2p/webhook
 * Twilio status callbacks.
 */
router.post("/webhook", async (req, res) => {
    console.log("[A2P Webhook] Received:", JSON.stringify(req.body, null, 2));
    // Implementation for handling Twilio's Brand/Campaign status callbacks
    res.status(200).send("OK");
});

export default router;
