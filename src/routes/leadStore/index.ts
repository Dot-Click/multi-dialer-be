import { Router } from "express";
import { protectRoute } from "../../middlewares/auth.middleware";
import {
  listLeadStoreServices,
  listMyLeadStoreSubscriptions,
  subscribeToLeadStoreService,
  cancelLeadStoreSubscription,
} from "./controller";

const router = Router();

router.get("/services", protectRoute, listLeadStoreServices);
router.get("/my-subscriptions", protectRoute, listMyLeadStoreSubscriptions);
router.post("/subscribe", protectRoute, subscribeToLeadStoreService);
router.post("/:id/cancel", protectRoute, cancelLeadStoreSubscription);

export default router;
