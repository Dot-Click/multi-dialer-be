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
  getContactsByList,
  importContactCsv,
  getAllImportContacts,
  exportContactCsv,
  getAllExportContacts,
} from "./controller";
import { singleUpload } from "../../middlewares/multer.middleware";

const router = Router();

router.get("/import-contacts", getAllImportContacts);
router.post("/import-csv", singleUpload("file"), importContactCsv);
router.post("/export-csv", exportContactCsv);
router.get("/export-csv", getAllExportContacts);

router.get("/list", getAllContactLists);
router.get("/folder", getAllContactFolders);
router.get("/group", getAllContactGroups);
router.get("/", getAllContacts);
router.get("/contacts-list/:lid", getContactsByList);
router.get("/:id", getContactById);
router.put("/:id", updateContact);
// router.patch("/:id/assign", assignContactToList);
// router.patch("/:id/groups", assignContactToGroups);
router.delete("/:id", deleteContact);
router.post("/create", createContact);
router.post("/list", createContactList);
router.patch("/list/:id", updateContactList);
router.delete("/list/:id", deleteContactList);
router.post("/folder", createContactFolder);
router.patch("/folder/:id", updateContactFolder);
router.delete("/folder/:id", deleteContactFolder);
router.post("/group", createContactGroup);
router.patch("/group/:id", updateContactGroup);
router.delete("/group/:id", deleteContactGroup);

export default router;
