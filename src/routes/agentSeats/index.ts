import { Router } from "express";
import { protectRoute, checkRole } from "../../middlewares/auth.middleware";
import { purchaseAgentSeat } from "./controller";

const router = Router();

router.post("/purchase", protectRoute, checkRole(["ADMIN", "OWNER"]), purchaseAgentSeat);

export default router;
