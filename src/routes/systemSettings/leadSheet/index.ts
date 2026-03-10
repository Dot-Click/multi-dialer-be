import { Router } from "express";
import {
  createLeadSheet,
  deleteLeadSheet,
  getLeadSheetById,
  getLeadSheets,
  updateLeadSheet,
} from "./controller";

import { checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// Create a Lead Sheet
router.post("/create", checkRole(["ADMIN", "OWNER"]), createLeadSheet);

// Get all Lead Sheets for current user
router.get("/", getLeadSheets);

// Get a single Lead Sheet by ID
router.get("/:id", getLeadSheetById);

// Update a Lead Sheet by ID
router.put("/:id", checkRole(["ADMIN", "OWNER"]), updateLeadSheet);

// Delete a Lead Sheet by ID
router.delete("/:id", checkRole(["ADMIN", "OWNER"]), deleteLeadSheet);

export * from "./controller";
export * from "./service";
export default router;


