import { Router } from "express";
import {
  createCallSettings,
  getAllCallSettingsOfAllUsers,
  getAllCallSettingsOfSpecificUser,
  getCallSettingsById,
  updateCallSettings,
  deleteCallSettings
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// Create a CallSettings
router.post("/create", createCallSettings);

// Get all CallSettings of all users
router.get("/all", getAllCallSettingsOfAllUsers);

// Get all CallSettings of specific user
router.get("/", getAllCallSettingsOfSpecificUser);

// Get a single CallSettings by ID
router.get("/:id", getCallSettingsById);

// Update a CallSettings by ID
router.put("/:id", updateCallSettings);

// Delete a CallSettings by ID
router.delete("/:id", deleteCallSettings);

export default router;

