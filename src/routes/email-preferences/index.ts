import { Router } from "express";
import { getEmailPreferences, updateEmailPreferences } from "./controller";

const router = Router();

router.get("/",  getEmailPreferences);
router.patch("/", updateEmailPreferences);

export default router;
