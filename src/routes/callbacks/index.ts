import { Router } from "express";
import {
  createCallback,
  getCallbacks,
  getDueCallbacks,
  getCallbackById,
  updateCallback,
  deleteCallback,
} from "./controller";

const router = Router();

router.post("/", createCallback);
router.get("/", getCallbacks);
// `/due` MUST be declared before `/:id` so it isn't captured as an id param.
router.get("/due", getDueCallbacks);
router.get("/:id", getCallbackById);
router.put("/:id", updateCallback);
router.delete("/:id", deleteCallback);

export default router;
