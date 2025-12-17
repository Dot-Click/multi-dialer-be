import { Router } from "express";
import {
  createAppearance,
  getAppearanceOfUser,
  updateAppearance,
  deleteAppearance
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// Create or initialize Appearance for user
router.post("/create", createAppearance);

// Get Appearance of specific user
router.get("/", getAppearanceOfUser);

// Update Appearance of user
router.put("/:id", updateAppearance);

// Delete Appearance of user
router.delete("/:id", deleteAppearance);

export default router;
