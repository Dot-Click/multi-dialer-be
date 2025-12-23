import { Router } from "express";
import { createContact, deleteContact, getAllContacts, getContactById, updateContact } from "./controller";

const router = Router();

router.post("/create", createContact);
router.get("/", getAllContacts);
router.get("/:id", getContactById);
router.put("/:id", updateContact);
router.delete("/:id", deleteContact);

export default router;


