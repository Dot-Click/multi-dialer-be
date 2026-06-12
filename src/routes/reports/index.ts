import { Router } from "express";
import { getAgentReport, getDialerHealth, getSalesAgentsPerformance, getAgentCallMetrics, getCallStatistics, refreshDialerHealth } from "./controller";
import { getCallDetailsReport } from "./call-details";
import { getSessionReport } from "./sessions";
import { getCallRecordingsReport } from "./call-recordings";
import { getAgentTimesheetReport } from "./timesheet";
import { getRecurringEventsReport } from "./recurring-events";
import { protectRoute } from "@/middlewares/auth.middleware";

const router = Router();

// Get agent specific report
router.get("/agent", protectRoute, getAgentReport);

// Get call details report
router.get("/call-details", protectRoute, getCallDetailsReport);

// Get session report
router.get("/sessions", protectRoute, getSessionReport);

// Get call recordings report
router.get("/call-recordings", protectRoute, getCallRecordingsReport);

// Get agent timesheet report
router.get("/agent-timesheet", protectRoute, getAgentTimesheetReport);

// Get recurring events report (aggregated Email/SMS/Call-back per contact)
router.get("/recurring-events", protectRoute, getRecurringEventsReport);

// Get dialer health
router.get("/dialer-health", protectRoute, getDialerHealth);

// Refresh dialer health (reputation)
router.get("/refresh-health", protectRoute, refreshDialerHealth);

// Get sales agents performance
router.get("/sales-performance", protectRoute, getSalesAgentsPerformance);

// Get agent call metrics
router.get("/agent-metrics", protectRoute, getAgentCallMetrics);

// Get call statistics
router.get("/call-statistics", protectRoute, getCallStatistics);

export default router;
