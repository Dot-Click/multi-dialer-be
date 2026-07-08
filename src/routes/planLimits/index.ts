import { Router } from "express";
import { protectRoute, checkRole } from "../../middlewares/auth.middleware";
import { getMyPlanLimits, getAllPlanLimits, upsertPlanLimits } from "./controller";

const router = Router();

router.get("/mine", protectRoute, getMyPlanLimits);
router.get("/", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), getAllPlanLimits);
router.put("/:planName", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), upsertPlanLimits);

export default router;
