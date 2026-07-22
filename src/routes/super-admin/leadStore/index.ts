import { Router } from "express";
import {
  listLeadStoreRequests,
  listMyPlusLeadsAccounts,
  getPortalAccounts,
  registerAccount,
  updateAccount,
  getAccountPackages,
  linkLeadStoreAccount,
  unlinkLeadStoreAccount,
} from "./controller";

const router = Router();

router.get("/requests", listLeadStoreRequests);
router.get("/accounts", listMyPlusLeadsAccounts);
router.get("/portal-accounts", getPortalAccounts);
router.post("/accounts", registerAccount);
router.patch("/accounts/:configId", updateAccount);
router.get("/accounts/:configId/packages", getAccountPackages);
router.post("/:leadStoreId/link", linkLeadStoreAccount);
router.post("/:leadStoreId/unlink", unlinkLeadStoreAccount);

export default router;
