import { Router } from "express";
import {
  createNotification,
  getNotification,
  updateNotification,
  deleteNotification
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// Create Notification Settings (Run once)
router.post("/", protectRoute, createNotification);

// Get Notification Settings
router.get("/", protectRoute, getNotification);

// Update Notification Settings
router.put("/:id", protectRoute, updateNotification);

// Delete Notification Settings
router.delete("/:id", protectRoute, deleteNotification);

export default router;