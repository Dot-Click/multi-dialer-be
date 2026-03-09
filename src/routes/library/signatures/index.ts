import { Router } from "express";
import { fetchSignature, saveSignature } from "./controller";
import { protectRoute } from "@/middlewares/auth.middleware";

const router = Router();

router.get("/", protectRoute, fetchSignature);
router.post("/", protectRoute, saveSignature);

export default router;