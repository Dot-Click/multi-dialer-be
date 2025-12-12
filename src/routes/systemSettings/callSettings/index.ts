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
router.post("/create", protectRoute, createCallSettings);

// Get all CallSettings of all users
router.get("/all", protectRoute, getAllCallSettingsOfAllUsers);

// Get all CallSettings of specific user
router.get("/", protectRoute, getAllCallSettingsOfSpecificUser);

// Get a single CallSettings by ID
router.get("/:id", protectRoute, getCallSettingsById);

// Update a CallSettings by ID
router.put("/:id", protectRoute, updateCallSettings);

// Delete a CallSettings by ID
router.delete("/:id", protectRoute, deleteCallSettings);

export default router;

