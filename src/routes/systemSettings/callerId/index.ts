import { Router } from "express";
import {
  createCallerId,
  getAllCallerIdsOfAllUsers,
  getAllCallerIdsOfSpecificUser,
  getCallerIdById,
  updateCallerId,
  deleteCallerId,
  getCallerIdStatus,  // ← add this import
  useCallerId,        // ← add this import
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";

const router = Router();

// ── Cooldown routes — must come BEFORE /:id to avoid param collision ──────────
router.get("/status", protectRoute, getCallerIdStatus);   // GET  /caller-id/status?numbers=...
router.post("/use",   protectRoute, useCallerId);          // POST /caller-id/use

// ── Standard CRUD ─────────────────────────────────────────────────────────────
router.post("/create", createCallerId);
router.get("/all",     getAllCallerIdsOfAllUsers);
router.get("/",        getAllCallerIdsOfSpecificUser);
router.get("/:id",     getCallerIdById);
router.put("/:id",     updateCallerId);
router.delete("/:id",  deleteCallerId);

export default router;