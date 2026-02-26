import { Router } from "express";
import { getAgentReport } from "./controller";
import { getCallDetailsReport } from "./call-details";
import { getSessionReport } from "./sessions";
import { protectRoute } from "@/middlewares/auth.middleware";

const router = Router();

// Get agent specific report
router.get("/agent", protectRoute, getAgentReport);

// Get call details report
router.get("/call-details", protectRoute, getCallDetailsReport);

// Get session report
router.get("/sessions", protectRoute, getSessionReport);

export default router;
