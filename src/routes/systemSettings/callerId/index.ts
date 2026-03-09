import { Router } from "express";
import {
  createCallerId,
  getAllCallerIdsOfAllUsers,
  getAllCallerIdsOfSpecificUser,
  getCallerIdById,
  updateCallerId,
  deleteCallerId
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// Create a CallerId
router.post("/create", createCallerId);

// Get all CallerIds of all users
router.get("/all", getAllCallerIdsOfAllUsers);

// Get all CallerIds of specific user
router.get("/", getAllCallerIdsOfSpecificUser);

// Get a single CallerId by ID
router.get("/:id", getCallerIdById);

// Update a CallerId by ID
router.put("/:id", updateCallerId);

// Delete a CallerId by ID
router.delete("/:id", deleteCallerId);

export default router;

