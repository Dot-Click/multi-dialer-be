import { Router } from "express";
import { getSmtpConfig, upsertSmtpConfig, testSmtpConfig, deleteSmtpConfig } from "./controller";

const router = Router();

router.get("/", getSmtpConfig);
router.post("/", upsertSmtpConfig);
router.post("/test", testSmtpConfig);
router.delete("/", deleteSmtpConfig);

export default router;
