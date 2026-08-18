import { Router } from "express";
import {
  getPlan,
  putPlan,
  getPlanTargets,
  getDashboard,
  getFunnel,
  getChannels,
  createStageEvent,
  deleteStageEvent,
  listSessions,
  createSession,
  patchSession,
  deleteSession,
  getLeaderboard,
} from "./controller";

const router = Router();

router.get("/plan", getPlan);
router.put("/plan", putPlan);
router.get("/plan/targets", getPlanTargets);

router.get("/dashboard", getDashboard);
router.get("/funnel", getFunnel);
router.get("/channels", getChannels);

router.post("/stage-event", createStageEvent);
router.delete("/stage-event/:id", deleteStageEvent);

router.get("/sessions", listSessions);
router.post("/sessions", createSession);
router.patch("/sessions/:id", patchSession);
router.delete("/sessions/:id", deleteSession);

router.get("/leaderboard", getLeaderboard);

export default router;
