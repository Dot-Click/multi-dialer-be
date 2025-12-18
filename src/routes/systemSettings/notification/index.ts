import { Router } from "express";
import {
  createNotification,
  getMyNotification,
  getAllNotifications,
  getNotificationById,
  updateNotification,
  deleteNotification
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// 1. Create (POST /create)
router.post("/create", protectRoute, createNotification);

// 2. Get All (GET /all) - Admin/Owner sees everyone's
router.get("/all", protectRoute, getAllNotifications);

// 3. Get My Settings (GET /)
router.get("/", protectRoute, getMyNotification);

// 4. Get By ID (GET /:id)
router.get("/:id", protectRoute, getNotificationById);

// 5. Update (PUT /:id) - Only Own
router.put("/:id", protectRoute, updateNotification);

// 6. Delete (DELETE /:id) - Only Own
router.delete("/:id", protectRoute, deleteNotification);

export default router;