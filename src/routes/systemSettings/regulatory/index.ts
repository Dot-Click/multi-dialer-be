import { Router } from "express";
import { getRegulatorySetting, updateRegulatorySetting } from "./controller";
import { checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

router.get("/", getRegulatorySetting);
router.put("/", checkRole(["ADMIN", "OWNER"]), updateRegulatorySetting);

export default router;
