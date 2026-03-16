import { Router } from "express";
import * as controller from "./controller";

const router = Router();

router.post("/subscribe", controller.subscribe as any);
router.post("/unsubscribe", controller.unsubscribe as any);

export default router;
