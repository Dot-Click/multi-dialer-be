import { Router } from "express";
import { getAgentReport } from "./controller";
import { protectRoute } from "@/middlewares/auth.middleware";

const router = Router();

// Get agent specific report
router.get("/agent", protectRoute, getAgentReport);

export default router;
