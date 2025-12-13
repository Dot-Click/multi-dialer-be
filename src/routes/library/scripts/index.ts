import { Router } from "express";
import { createScript, getAllScriptsOfAllUsers, getAllScriptsOfSpecificUser, getScriptById, updateScript, deleteScript } from "./controller";
import { protectRoute, checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// Create a script
router.post("/create", createScript);
// get all users scripts 
router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllScriptsOfAllUsers);

// Get all scripts of specific user
router.get("/", getAllScriptsOfSpecificUser);

// Get a single script by ID
router.get("/:id", getScriptById);

// Update a script by ID
router.put("/:id", updateScript);

// Delete a script by ID
router.delete("/:id", deleteScript);

export default router;
