import { Router } from "express";
import { getRegulatorySetting, updateRegulatorySetting } from "./controller";

const router = Router();

router.get("/", getRegulatorySetting);
router.put("/", updateRegulatorySetting);

export default router;
