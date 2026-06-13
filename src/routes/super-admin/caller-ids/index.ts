import { Router } from "express";
import { listCallerIds, createCallerIdForUser, updateAnyCallerId, deleteAnyCallerId, listAvailableNumbers } from "./controller";

const router = Router();

router.get("/available-numbers", listAvailableNumbers);
router.get("/", listCallerIds);
router.post("/", createCallerIdForUser);
router.put("/:id", updateAnyCallerId);
router.delete("/:id", deleteAnyCallerId);

export default router;
