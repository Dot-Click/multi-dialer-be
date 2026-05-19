import { Router } from "express";
import { protectRoute } from "../../middlewares/auth.middleware";
import { getBillingPortal, getSubscriptions, getPlans } from "./controller";

const router = Router();

router.get("/portal", protectRoute, getBillingPortal);
router.get("/subscriptions", protectRoute, getSubscriptions);
router.get("/plans", protectRoute, getPlans);

export default router;
