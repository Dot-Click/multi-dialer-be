import { Router } from "express";
import {
  alerts,
  billingReportDetail,
  getUserOverview,
  newAccountsOverTime,
  revenueGrowth,
  userReportsBilling,
  userSubscriptionDetails,
  userSubscriptionStatus,
  businessOverview,
  revenuePlans,
  totalConnections,
  appointmentsSet,
  avgDaysSinceActive,
  planChanges,
  activeUsers,
  callStats,
} from "./controller";

const router = Router();

// Home APIs
router.get("/user-overview", getUserOverview);
router.get("/new-accounts", newAccountsOverTime);
router.get("/alerts", alerts);
router.get("/user-subscriptions", userSubscriptionDetails);
router.get("/user-subscription-status", userSubscriptionStatus);

// Reports of user and billing
router.get("/revenue-growth", revenueGrowth);
router.get("/billing-report-detail", billingReportDetail);
router.get("/user-reports-billing", userReportsBilling);

//reporting
router.get("/bussiness-overview", businessOverview);
router.get("/revenue-plans", revenuePlans);

// Usage & activity metrics
router.get("/total-connections", totalConnections);
router.get("/appointments-set", appointmentsSet);
router.get("/avg-days-since-active", avgDaysSinceActive);
router.get("/plan-changes", planChanges);
router.get("/active-users", activeUsers);
router.get("/call-stats", callStats);

export default router;
