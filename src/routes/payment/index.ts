import { Router } from "express";
import { createCheckoutSession } from "./controller";

const router = Router();

router.post("/create-checkout-session", createCheckoutSession);

export default router;
