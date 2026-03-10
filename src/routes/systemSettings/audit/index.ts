import { Router } from "express";
import { getAuditLogs } from "./controller";

const router = Router();

router.get("/", getAuditLogs);

export default router;
