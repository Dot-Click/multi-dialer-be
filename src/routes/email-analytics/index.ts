import { Router } from "express";
import { getSummary, getTimeline, getLogs, getDeadQueue } from "./controller";

const router = Router();

router.get("/summary",    getSummary);
router.get("/timeline",   getTimeline);
router.get("/logs",       getLogs);
router.get("/queue/dead", getDeadQueue);

export default router;
