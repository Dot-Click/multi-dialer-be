import { Router } from "express";
import {
  listLeadStoreRequests,
  listMyPlusLeadsAccounts,
  linkLeadStoreAccount,
  unlinkLeadStoreAccount,
} from "./controller";

const router = Router();

router.get("/requests", listLeadStoreRequests);
router.get("/accounts", listMyPlusLeadsAccounts);
router.post("/:leadStoreId/link", linkLeadStoreAccount);
router.post("/:leadStoreId/unlink", unlinkLeadStoreAccount);

export default router;
