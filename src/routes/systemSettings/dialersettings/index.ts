import { Router } from "express";
import { 
  createDialerSettings,
  getDialerSettings, 
  updateDialerSettings,
  deleteDialerSettings
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// Create Settings (Only works once per user)
router.post("/", protectRoute, createDialerSettings);

// Get Settings
router.get("/", protectRoute, getDialerSettings);

// Update Settings
router.put("/:id", protectRoute, updateDialerSettings);

// Delete Settings
router.delete("/:id", protectRoute, deleteDialerSettings);

export default router;