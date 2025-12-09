import { Router } from "express";
import { createScript, getAllScriptsOfAllUsers, getAllScriptsOfSpecificUser, getScriptById, updateScript, deleteScript } from "./controller";
import { protectRoute, checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// Create a script
router.post("/create", protectRoute, createScript);

// get all users scripts 
router.get("/all", protectRoute, getAllScriptsOfAllUsers);

// Get all scripts of specific user
router.get("/", protectRoute, getAllScriptsOfSpecificUser);

// Get a single script by ID
router.get("/:id", protectRoute, getScriptById);

// Update a script by ID
router.put("/:id", protectRoute, updateScript);

// Delete a script by ID
router.delete("/:id", protectRoute, deleteScript);

export default router;
