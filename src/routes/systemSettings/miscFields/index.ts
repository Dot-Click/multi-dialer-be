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

import { checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// Create a misc field
router.post("/create", checkRole(["ADMIN", "OWNER"]), createMiscField);

// Get all misc fields of all users
router.get("/all", getAllMiscFieldsOfAllUsers);

// Get all misc fields of specific user
router.get("/", getAllMiscFieldsOfSpecificUser);

// Get a single misc field by ID
router.get("/:id", getMiscFieldById);

// Update a misc field by ID
router.put("/:id", checkRole(["ADMIN", "OWNER"]), updateMiscField);

// Delete a misc field by ID
router.delete("/:id", checkRole(["ADMIN", "OWNER"]), deleteMiscField);

export default router;

