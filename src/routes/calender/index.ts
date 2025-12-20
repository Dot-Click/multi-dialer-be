import { Router } from "express";
import {
  createCalendarEvent,
  getAllCalendarEvents,
  getCalendarEventById,
  getCalendarEvents,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "./controller";
import { checkRole } from "../../middlewares/auth.middleware";

const router = Router();

router.post("/create", createCalendarEvent);
router.get("/", getCalendarEvents);
router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllCalendarEvents);
router.get("/:id", getCalendarEventById);
router.put("/:id", updateCalendarEvent);
router.delete("/:id", deleteCalendarEvent);

export default router;

