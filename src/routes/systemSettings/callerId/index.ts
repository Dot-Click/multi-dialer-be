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
router.post("/create", protectRoute, createCallerId);

// Get all CallerIds of all users
router.get("/all", protectRoute, getAllCallerIdsOfAllUsers);

// Get all CallerIds of specific user
router.get("/", protectRoute, getAllCallerIdsOfSpecificUser);

// Get a single CallerId by ID
router.get("/:id", protectRoute, getCallerIdById);

// Update a CallerId by ID
router.put("/:id", protectRoute, updateCallerId);

// Delete a CallerId by ID
router.delete("/:id", protectRoute, deleteCallerId);

export default router;

