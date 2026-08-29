import { Router } from "express";
import { protectRoute } from "../../middlewares/auth.middleware";
import {
    a2pRegistrationService,
    ResubmitError,
    type A2PCampaignDetails,
} from "../../services/a2pRegistrationService";
import prisma from "../../lib/prisma";
import { decryptEIN } from "../../utils/encryption";

const router = Router();

/**
 * Cost of a TCR brand resubmission, in USD. Static for now — surfaced in
 * the panel confirmation copy so the user sees what they're spending.
 * Read from env when TCR ever varies this by tier.
 */
const BRAND_RESUBMIT_FEE_USD = 4;

/**
 * Maps ResubmitError codes to HTTP status. Terminal / not-rejected are
 * 409 (conflict with resource state), missing upstream dependency is 424
 * (failed dependency), missing registration is 404.
 */
const resubmitStatus = (code: ResubmitError["code"]): number => {
    switch (code) {
        case "NOT_STARTED": return 404;
        case "NOT_REJECTED":
        case "TERMINAL": return 409;
        case "CP_NOT_APPROVED":
        case "BRAND_NOT_APPROVED":
        case "NO_MESSAGING_SERVICE": return 424;
    }
};

const handleResubmitError = (res: any, err: unknown) => {
    if (err instanceof ResubmitError) {
        res.status(resubmitStatus(err.code)).json({ code: err.code, message: err.message });
        return true;
    }
    return false;
};

/**
 * POST /api/a2p/submit
 * Submits business + campaign details for A2P registration.
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
 * Returns per-stage A2P status for the logged-in user. Kicks off a Twilio
 * status sync first so the UI never shows stale "pending" when Twilio has
 * already made a decision. Sync is best-effort — if Twilio is unreachable
 * we still return the DB state.
 *
 * Response shape:
 *   {
 *     overallStatus,               // NOT_STARTED | PENDING | APPROVED | REJECTED
 *     rejectionReason,             // rollup, first non-null stage message
 *     customerProfileApproved,     // VI + CNAM key off this
 *     stages: {
 *       customerProfile: { status, retriable, message, code, suggestedFields },
 *       brand:           { status, retriable, message, code, suggestedFields, resubmitFeeUsd, resubmitCount },
 *       campaign:        { status, retriable, message, code, suggestedFields, resubmitCount },
 *     },
 *     unblocksDownstream: { voiceIntegrity, cnam },
 *   }
 */
router.get("/status", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
        await a2pRegistrationService.checkA2PStatus(userId).catch((err: any) =>
            console.warn(`[A2P] checkA2PStatus for ${userId} failed:`, err?.message)
        );
        const reg = await prisma.a2P_Registration.findUnique({
            where: { userId },
            select: {
                status: true,
                rejectionReason: true,
                customerProfileApproved: true,
                cpStatus: true,
                cpRejectionReason: true,
                cpRejectionCode: true,
                cpRetriable: true,
                brandStatus: true,
                brandRejectionReason: true,
                brandRejectionCode: true,
                brandRetriable: true,
                brandResubmitCount: true,
                campaignStatus: true,
                campaignRejectionReason: true,
                campaignRejectionCode: true,
                campaignRetriable: true,
                campaignResubmitCount: true,
            },
        });

        if (!reg) {
            res.json({
                // `status` is kept alongside `overallStatus` so the existing
                // frontend slice (which reads `status`) keeps working until
                // Phase 4 replaces it with the per-stage shape.
                status: "NOT_STARTED",
                overallStatus: "NOT_STARTED",
                rejectionReason: null,
                customerProfileApproved: false,
                stages: {
                    customerProfile: emptyStage(),
                    brand: { ...emptyStage(), resubmitFeeUsd: BRAND_RESUBMIT_FEE_USD, resubmitCount: 0 },
                    campaign: { ...emptyStage(), resubmitCount: 0 },
                },
                unblocksDownstream: { voiceIntegrity: false, cnam: false },
            });
            return;
        }

        res.json({
            // Legacy top-level fields for the current frontend slice.
            status: reg.status,
            overallStatus: reg.status,
            rejectionReason: reg.rejectionReason,
            customerProfileApproved: reg.customerProfileApproved,
            stages: {
                customerProfile: {
                    status: reg.cpStatus,
                    retriable: reg.cpRetriable,
                    message: reg.cpRejectionReason,
                    code: reg.cpRejectionCode,
                    suggestedFields: [],
                },
                brand: {
                    status: reg.brandStatus,
                    retriable: reg.brandRetriable,
                    message: reg.brandRejectionReason,
                    code: reg.brandRejectionCode,
                    suggestedFields: [],
                    resubmitFeeUsd: BRAND_RESUBMIT_FEE_USD,
                    resubmitCount: reg.brandResubmitCount,
                },
                campaign: {
                    status: reg.campaignStatus,
                    retriable: reg.campaignRetriable,
                    message: reg.campaignRejectionReason,
                    code: reg.campaignRejectionCode,
                    suggestedFields: [],
                    resubmitCount: reg.campaignResubmitCount,
                },
            },
            // Downstream Trust Hub features (Voice Integrity, CNAM) attach
            // to the Customer Profile, not the brand or campaign. Both
            // unblock the moment the CP is approved.
            unblocksDownstream: {
                voiceIntegrity: reg.customerProfileApproved,
                cnam: reg.customerProfileApproved,
            },
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * GET /api/a2p/details
 * Returns the previously-submitted A2P business + campaign details so the
 * frontend can prefill both the onboarding wizard and the resubmit modals.
 * EIN is decrypted here so the admin sees what they submitted.
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
                useCase: true,
                businessIndustry: true,
                messageSamples: true,
                optInDetails: true,
                optInKeywords: true,
                optOutKeywords: true,
                helpKeywords: true,
                helpMessage: true,
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
 * POST /api/a2p/resubmit/customer-profile
 * Resubmit only the Customer Profile after a twilio-rejection. Body is
 * the same shape as /submit's business fields (campaign fields carry
 * over from the stored row).
 */
router.post("/resubmit/customer-profile", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
        const result = await a2pRegistrationService.resubmitCustomerProfile(userId, req.body);
        res.json(result);
    } catch (error: any) {
        if (handleResubmitError(res, error)) return;
        res.status(500).json({ message: error.message });
    }
});

/**
 * POST /api/a2p/resubmit/brand
 * Resubmit only the brand — reuses the approved CP. Charges the TCR
 * resubmission fee, so the frontend confirms with the user first.
 */
router.post("/resubmit/brand", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
        const result = await a2pRegistrationService.resubmitBrand(userId);
        res.json(result);
    } catch (error: any) {
        if (handleResubmitError(res, error)) return;
        res.status(500).json({ message: error.message });
    }
});

/**
 * POST /api/a2p/resubmit/campaign
 * Resubmit only the campaign with new samples / opt-in-out / help copy.
 * No TCR fee — the campaign is recreated on the existing messaging
 * service so number attachments don't need rewiring.
 */
router.post("/resubmit/campaign", protectRoute, async (req: any, res) => {
    try {
        const userId = req.user.id;
        const body = req.body as Partial<A2PCampaignDetails>;
        // Validate the minimum set of campaign fields — everything else
        // has defaults or is optional at the TCR layer.
        if (!body?.useCase || !Array.isArray(body.messageSamples) || body.messageSamples.length === 0) {
            res.status(400).json({
                message: "useCase and at least one messageSample are required.",
            });
            return;
        }
        const details: A2PCampaignDetails = {
            useCase: body.useCase,
            businessIndustry: body.businessIndustry,
            messageSamples: body.messageSamples,
            optInDetails: body.optInDetails ?? "",
            optInKeywords: body.optInKeywords ?? [],
            optOutKeywords: body.optOutKeywords ?? [],
            helpKeywords: body.helpKeywords ?? [],
            helpMessage: body.helpMessage ?? "",
        };
        const result = await a2pRegistrationService.resubmitCampaign(userId, details);
        res.json(result);
    } catch (error: any) {
        if (handleResubmitError(res, error)) return;
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

const emptyStage = () => ({
    status: null as string | null,
    retriable: null as boolean | null,
    message: null as string | null,
    code: null as string | null,
    suggestedFields: [] as string[],
});

export default router;
