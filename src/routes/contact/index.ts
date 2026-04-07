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
  assignContactToList,
  assignContactToGroups,
  sendLeadSheetEmail,
  uploadAttachment,
  getAttachments,
  deleteAttachment,
  assignAgentsToList,
  moveToDnc,
  removeFromDnc,
  getDncList,
  getAllImportContacts,
  importContactCsv,
  exportContactCsv,
  getAllExportContacts,
  getAllBackupContacts,
  getHotlist,
  sendTemplateEmail,
  scheduleTemplateEmail,
  bulkAssignContactsToList,
  bulkMoveToDnc,
  addContactNote,
} from "./controller";
import { singleUpload } from "@/middlewares/multer.middleware";

const router = Router();


router.get("/hotlist", getHotlist);
router.get("/backup-contacts", getAllBackupContacts);

router.get("/import-contacts", getAllImportContacts);
router.post("/import-csv", singleUpload("file"), importContactCsv);
router.post("/export-csv", exportContactCsv);
router.get("/export-csv", getAllExportContacts);

router.get("/list", getAllContactLists);
router.get("/folder", getAllContactFolders);
router.get("/group", getAllContactGroups);
router.get("/", getAllContacts);
router.get("/dnc-list", getDncList);
router.get("/contacts-list/:lid", getContactsByList);
router.get("/:id", getContactById);
router.put("/:id", updateContact);
router.post("/:id/note", addContactNote);
router.patch("/:id/assign", assignContactToList);
router.patch("/:id/groups", assignContactToGroups);
router.post("/:id/leadsheet/send-email", sendLeadSheetEmail);
router.post("/:id/send-template-email", sendTemplateEmail);
router.post("/:id/schedule-template-email", scheduleTemplateEmail);

// Attachments
router.post("/:id/attachment", singleUpload("file"), uploadAttachment);
router.get("/:id/attachment", getAttachments);
router.delete("/attachment/:attachmentId", deleteAttachment);

// router.delete("/:id", deleteContact); // BACKUP ROUTE
router.delete("/:id", deleteContact);

router.post("/:id/move-to-dnc", moveToDnc);
router.post("/:id/remove-from-dnc", removeFromDnc);
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

router.patch("/list/:id/agents", assignAgentsToList);

router.post("/bulk-assign-list", bulkAssignContactsToList);
router.post("/bulk-move-to-dnc", bulkMoveToDnc);

export default router;