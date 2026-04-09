import { Router } from "express";
import * as controller from "./controller";
import { protectRoute } from "../../middlewares/auth.middleware";

const router = Router();

router.post("/subscribe", protectRoute, controller.subscribe as any);
router.post("/unsubscribe", controller.unsubscribe as any);

export default router;
