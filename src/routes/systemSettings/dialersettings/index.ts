import { Router } from "express";
import { 
  createDialerSettings,
  getMyDialerSettings, 
  getAllDialerSettings,
  getDialerSettingById,
  updateDialerSettings,
  deleteDialerSettings
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// 1. Create Settings (POST /create)
router.post("/create", protectRoute, createDialerSettings);

// 2. Get All Settings (GET /all)
// Admin/Owner sees everyone's settings
router.get("/all", protectRoute, getAllDialerSettings);

// 3. Get My Settings (GET /)
// Fetch settings associated with the logged-in User's ID
router.get("/", protectRoute, getMyDialerSettings);

// 4. Get Specific Setting by ID (GET /:id)
// Fetch a setting by its unique DB ID
router.get("/:id", protectRoute, getDialerSettingById);

// 5. Update Settings (PUT /:id)
// Strict: Can only update YOUR OWN setting
router.put("/:id", protectRoute, updateDialerSettings);

// 6. Delete Settings (DELETE /:id)
// Strict: Can only delete YOUR OWN setting
router.delete("/:id", protectRoute, deleteDialerSettings);

export default router;