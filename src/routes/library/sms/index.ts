import { Router } from "express";
import { createSms, getAllSmsOfAllUsers, getAllSmsOfSpecificUser, getSmsById, updateSms, deleteSms } from "./controller";
import { protectRoute, checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// Create an SMS template
router.post("/create", createSms);

// Get all SMS templates of all users
router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllSmsOfAllUsers);

// Get all SMS templates of specific user
router.get("/", getAllSmsOfSpecificUser);

// Get a single SMS template by ID
router.get("/:id", getSmsById);

// Update an SMS template by ID
router.put("/:id", updateSms);

// Delete an SMS template by ID
router.delete("/:id", protectRoute, deleteSms);

export default router;
