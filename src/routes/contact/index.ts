import { Router } from "express";
import { 
  createContact, 
  deleteContact, 
  getAllContacts, 
  getContactById, 
  updateContact, 
  createContactList, 
  createContactFolder, 
  createContactGroup, 
  getAllContactLists, 
  getAllContactFolders, 
  getAllContactGroups, 
  updateContactFolder, 
  updateContactList,
  updateContactGroup,
  deleteContactList,
  deleteContactFolder,
  deleteContactGroup,
  getContactsByList
} from "./controller";

const router = Router();

router.get("/list", getAllContactLists);
router.get("/folder", getAllContactFolders);
router.get("/group", getAllContactGroups);
router.get("/", getAllContacts);
router.get("/contacts-list/:lid", getContactsByList)
router.get("/:id", getContactById);
router.put("/:id", updateContact);
router.delete("/:id", deleteContact);
router.post("/create", createContact);
router.post("/list", createContactList);
router.patch("/list/:id", updateContactList)
router.delete("/list/:id", deleteContactList);
router.post("/folder", createContactFolder);
router.patch("/folder/:id", updateContactFolder);
router.delete("/folder/:id", deleteContactFolder);
router.post("/group", createContactGroup);
router.patch("/group/:id", updateContactGroup);
router.delete("/group/:id", deleteContactGroup);


export default router;


