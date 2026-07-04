import { Router } from "express";
import { checkRole, protectRoute } from "../../middlewares/auth.middleware";
import { getBillingPortal, getSubscriptions, getPlans, updatePlan, changeSubscriptionPlan, cancelSubscription, upgradeSubscription, getInvoicesByCustomer, getInvoicesByUser, getAllInvoices, getInvoiceById, getInvoiceCard, createPlan, deletePlan, getFailedPayments, getUpcomingRenewals, getAllInvoicesAdmin, getAllSubscriptionsAdmin, getAccessStatus } from "./controller";

const router = Router();

router.get("/access-status", protectRoute, getAccessStatus);
router.get("/portal", protectRoute, getBillingPortal);
router.get("/subscriptions", protectRoute, getSubscriptions);
router.get("/plans/public", getPlans);
router.get("/plans", protectRoute, getPlans);
router.post("/plans", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), createPlan);
router.put("/plans/:plan", protectRoute, checkRole(["OWNER"]), updatePlan);
router.delete("/plans/:plan", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), deletePlan);
router.put("/subscription/:subscriptionId/plan", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), changeSubscriptionPlan);
router.post("/subscription/cancel", protectRoute, cancelSubscription);
router.post("/subscription/upgrade", protectRoute, upgradeSubscription);
router.get("/invoices/all", protectRoute, getAllInvoices);
router.get("/invoices/admin-all", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getAllInvoicesAdmin);
router.get("/subscriptions/all", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getAllSubscriptionsAdmin);
router.get("/invoices/by-user/:userId", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getInvoicesByUser);
router.get("/invoices", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getInvoicesByCustomer);
router.get("/invoices/:invoiceId/card", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getInvoiceCard);
router.get("/invoices/:invoiceId", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getInvoiceById);
router.get("/failed-payments", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getFailedPayments);
router.get("/upcoming-renewals", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getUpcomingRenewals);

export default router;
