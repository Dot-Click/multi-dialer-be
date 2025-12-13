import { Router } from "express";
import { 
  createMiscField, 
  getAllMiscFieldsOfAllUsers, 
  getAllMiscFieldsOfSpecificUser, 
  getMiscFieldById, 
  updateMiscField, 
  deleteMiscField 
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// Create a misc field
router.post("/create", protectRoute, createMiscField);

// Get all misc fields of all users
router.get("/all", protectRoute, getAllMiscFieldsOfAllUsers);

// Get all misc fields of specific user
router.get("/", protectRoute, getAllMiscFieldsOfSpecificUser);

// Get a single misc field by ID
router.get("/:id", protectRoute, getMiscFieldById);

// Update a misc field by ID
router.put("/:id", protectRoute, updateMiscField);

// Delete a misc field by ID
router.delete("/:id", protectRoute, deleteMiscField);

export default router;

