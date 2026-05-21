import { Router } from "express";
import { checkRole, protectRoute } from "../../middlewares/auth.middleware";
import { getBillingPortal, getSubscriptions, getPlans, updatePlan } from "./controller";

const router = Router();

router.get("/portal", protectRoute, getBillingPortal);
router.get("/subscriptions", protectRoute, getSubscriptions);
router.get("/plans", protectRoute, getPlans);
router.put("/plans/:plan", protectRoute, checkRole(["OWNER"]), updatePlan);

export default router;
