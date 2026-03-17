import { Router } from "express";
import { getMyNotifications, markAsRead, markAllAsRead } from "./controller";
import { protectRoute } from "../../middlewares/auth.middleware";

const router = Router();

router.get("/", protectRoute, getMyNotifications);
router.put("/mark-read/:id", protectRoute, markAsRead);
router.put("/mark-all-read", protectRoute, markAllAsRead);

export default router;
