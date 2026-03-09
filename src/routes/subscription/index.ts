import { Router } from "express";
import { createSubscription, listPlans, zohoAuth, zohoAuthCallback, getUpdateCardUrl, listSubscriptions, listBillings, fetchZohoPlans } from "./controller";
import { protectRoute, checkRole } from "../../middlewares/auth.middleware";

const router = Router();

/**
 * Route to fetch all Zoho plans.
 */
router.get("/plans", listPlans);

/**
 * Route to create a new Zoho subscription.
 */
router.post("/",protectRoute, createSubscription);

router.post("/update-card-link", protectRoute, getUpdateCardUrl);

router.get("/auth", zohoAuth);
// Zoho callback route
router.get("/callback", zohoAuthCallback);  

router.get("/list",protectRoute,listSubscriptions)
router.get("/billings",protectRoute,fetchZohoPlans)

export default router;
