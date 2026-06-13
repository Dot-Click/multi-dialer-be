import { Router } from "express";
import { checkRole, protectRoute } from "../../middlewares/auth.middleware";
import { getBillingPortal, getSubscriptions, getPlans, updatePlan, changeSubscriptionPlan, getInvoicesByCustomer, createPlan, deletePlan, getFailedPayments, getUpcomingRenewals } from "./controller";

const router = Router();

router.get("/portal", protectRoute, getBillingPortal);
router.get("/subscriptions", protectRoute, getSubscriptions);
router.get("/plans", protectRoute, getPlans);
router.post("/plans", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), createPlan);
router.put("/plans/:plan", protectRoute, checkRole(["OWNER"]), updatePlan);
router.delete("/plans/:plan", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), deletePlan);
router.put("/subscription/:subscriptionId/plan", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), changeSubscriptionPlan);
router.get("/invoices", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getInvoicesByCustomer);
router.get("/failed-payments", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getFailedPayments);
router.get("/upcoming-renewals", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getUpcomingRenewals);

export default router;
