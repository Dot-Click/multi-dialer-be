import { Router } from "express";
import {
  createContactList,
  deleteContactList,
  getAllContactLists,
  getContactListById,
  updateContactList,
} from "./controller";

const router = Router();

router.post("/create", createContactList);
router.get("/", getAllContactLists);
router.get("/:id", getContactListById);
router.put("/:id", updateContactList);
router.delete("/:id", deleteContactList);

export default router;


