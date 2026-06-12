import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import {
  createContactGroupSchema,
  createContactSchema,
  createListFolderSchema,
  updateContactSchema,
} from "../../schemas/contact.schema";
import {
  createContactInDb,
  deleteContactFromDb,
  getAllContactsFromDb,
  getContactByIdFromDb,
  updateContactInDb,
  addContactNoteInDb,
  getDuplicateContactsFromDb,
  createContactListInDb,
  createContactFolderInDb,
  createContactGroupInDb,
  getAllContactGroupsFromDb,
  getAllContactFoldersFromDb,
  getAllContactListsFromDb,
  updateContactFolderInDb,
  updateContactListInDb,
  ensureDncFolder,
  updateContactGroupInDb,
  deleteContactListFromDb,
  deleteContactFolderFromDb,
  deleteContactGroupFromDb,
  getContactsByListFromDb,
  assignContactToListInDb,
  assignContactToGroupsInDb,
  sendLeadSheetEmailInDb,
  uploadAttachmentInDb,
  getAttachmentsForContactInDb,
  deleteAttachmentFromDb,
  assignAgentsToListInDb,
  moveToDncInDb,
  removeFromDncInDb,
  getDncListFromDb,
  getAllExportContactsFromDb,
  exportContactsInDb,
  getAllImportContactsFromDb,
  importContactsInDb,
  getAllBackupContactsFromDb,
  restoreContactFromDb,
  permanentlyDeleteContactFromDb,
  getHotlistFromDb,
  sendTemplateEmailInDb,
  scheduleTemplateEmailInDb,
  bulkAssignContactsToListInDb,
  bulkMoveToDncInDb,
  assignContactToFolderInDb,
  getContactsByFolderFromDb,
  bulkDeleteContactsInDb,
  bulkAssignContactsToFolderInDb,
  mergeContactsInDb,
  getRealtorLinkForContactInDb,
} from "./service";
import {
  createContactListSchema,
  updateContactListSchema,
} from "../../schemas/contactlist.schema";
import { parse } from "csv-parse/sync";
import * as xlsx from "xlsx";

export const createContact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const payload = { ...req.body };
    console.log("payload", payload);
    const result = (await validateData(createContactSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const userId = (req as any).user.id;
    const contact = await createContactInDb({ ...result.data, userId });
    successResponse(res, 200, "Contact created", contact);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAllContacts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const role = (req as any).user.role;
    const contacts = await getAllContactsFromDb(userId, role);
    successResponse(res, 200, "Contacts fetched", contacts);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getContactById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }
    const contact = await getContactByIdFromDb(id);
    successResponse(res, 200, "Contact fetched", contact);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getRealtorLink = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }

    const realtorData = await getRealtorLinkForContactInDb(id);
    successResponse(res, 200, "Realtor property link fetched", realtorData);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const updateContact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }

    const payload = { ...req.body };
    const result = (await validateData(updateContactSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const userId = (req as any).user.id;
    const updated = await updateContactInDb(id, result.data, userId);
    successResponse(res, 200, "Contact updated", updated);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const addContactNote = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    if (!id || !note) {
      errorResponse(res, "Contact id and note are required", 400);
      return;
    }

    const updated = await addContactNoteInDb(id, note);
    successResponse(res, 200, "Note added successfully", updated);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getDuplicateContacts = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const duplicates = await getDuplicateContactsFromDb();
    successResponse(res, 200, "Duplicate contacts fetched", duplicates);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

/* BACKUP
export const deleteContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }
    await deleteContactFromDb(id, (req as any).user.id);
    successResponse(res, 200, "Contact deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};
*/

export const deleteContact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    let { restore, delete: deleteQuery, folderId, listId } = req.query;

    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }

    const userId = (req as any).user.id;
    const referer = req.headers.referer;

    // Smart Context Inference: If folderId is missing, try to get it from the URL
    if (!folderId && referer) {
      const match = referer.match(/\/contacts-folder\/([^\/\s\?]+)/);
      if (match) folderId = match[1];
    }

    if (restore === "true") {
      await restoreContactFromDb(id, userId);
      successResponse(res, 200, "Contact restored successfully", null);
    } else if (deleteQuery === "true") {
      await permanentlyDeleteContactFromDb(id, userId);
      successResponse(
        res,
        200,
        "Contact permanently deleted successfully",
        null,
      );
    } else if (folderId || listId) {
      // Contextual Removal: use the bulk logic for a single ID
      await bulkDeleteContactsInDb(userId, [id], {
        folderId: folderId as string,
        listId: listId as string,
        hardDelete: false
      });
      successResponse(res, 200, "Contact removed from folder/list successfully", null);
    } else {
      await deleteContactFromDb(id, userId);
      successResponse(res, 200, "Contact deleted successfully", null);
    }
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const assignContactToList = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { listId } = req.body;
    if (!id || !listId) {
      errorResponse(res, "Contact ID and List ID are required", 400);
      return;
    }
    const updated = await assignContactToListInDb(id, listId);
    successResponse(res, 200, "Contact assigned to list successfully", updated);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const assignAgentsToList = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { agentIds } = req.body;
  const updated = await assignAgentsToListInDb(id, agentIds);
  successResponse(res, 200, "Agents assigned", updated);
};

export const assignContactToGroups = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { groupIds } = req.body;
    const userId = (req as any).user.id;
    if (!id || !groupIds) {
      errorResponse(res, "Contact ID and Group IDs are required", 400);
      return;
    }
    const updated = await assignContactToGroupsInDb(id, groupIds, userId);
    successResponse(res, 200, "Contact groups updated successfully", updated);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const createContactList = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(
      createContactListSchema,
      payload,
    )) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const contactList = await createContactListInDb(
      result.data,
      (req as any).user.id,
    );
    successResponse(res, 201, "Contact list created", contactList);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const updateContactList = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact list id is required", 400);
      return;
    }
    const payload = { ...req.body };
    const result = (await validateData(
      updateContactListSchema,
      payload,
    )) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updated = await updateContactListInDb(id, result.data);
    successResponse(res, 200, "Contact list updated", updated);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const createContactFolder = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(createListFolderSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const contactFolder = await createContactFolderInDb(
      result.data,
      (req as any).user.id,
    );
    successResponse(res, 201, "Contact folder created", contactFolder);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const updateContactFolder = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact folder id is required", 400);
      return;
    }
    const payload = { ...req.body };
    const result = (await validateData(
      createListFolderSchema.partial(),
      payload,
    )) as any;

    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updated = await updateContactFolderInDb(id, result.data);
    successResponse(res, 200, "Contact folder updated", updated);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const createContactGroup = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(
      createContactGroupSchema,
      payload,
    )) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const userId = (req as any).user.id;

    const contactGroup = await createContactGroupInDb(userId, result.data);
    successResponse(res, 201, "Contact group created", contactGroup);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const updateContactGroup = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact group id is required", 400);
      return;
    }
    const payload = { ...req.body };
    const result = (await validateData(
      createContactGroupSchema.partial(),
      payload,
    )) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updated = await updateContactGroupInDb(id, result.data);
    successResponse(res, 200, "Contact group updated", updated);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const deleteContactList = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact list id is required", 400);
      return;
    }
    await deleteContactListFromDb(id);
    successResponse(res, 200, "Contact list deleted successfully", null);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const deleteContactFolder = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact folder id is required", 400);
      return;
    }
    await deleteContactFolderFromDb(id);
    successResponse(res, 200, "Contact folder deleted successfully", null);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const deleteContactGroup = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact group id is required", 400);
      return;
    }
    await deleteContactGroupFromDb(id);
    successResponse(res, 200, "Contact group deleted successfully", null);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAllContactLists = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const contactLists = await getAllContactListsFromDb(
      (req as any).user.id,
      (req as any).user.role,
    );
    successResponse(res, 200, "Contact lists fetched", contactLists);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAllContactFolders = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const role = (req as any).user.role;

    // Lazy load system DNC folder
    await ensureDncFolder(userId);

    const contactFolders = await getAllContactFoldersFromDb(userId, role);
    successResponse(res, 200, "Contact folders fetched", contactFolders);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAllContactGroups = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const contactGroups = await getAllContactGroupsFromDb(
      (req as any).user.id,
      (req as any).user.role,
    );
    successResponse(res, 200, "Contact groups fetched", contactGroups);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getContactsByList = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { lid } = req.params;
    if (!lid) {
      errorResponse(res, "Contact list id is required", 400);
      return;
    }
    const userId = (req as any).user.id;
    const role = (req as any).user.role;
    const contacts = await getContactsByListFromDb(lid, userId, role);
    successResponse(res, 200, "Contacts fetched", contacts);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const sendLeadSheetEmail = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { leadSheetId, recipientEmail } = req.body;

    if (!id || !leadSheetId || !recipientEmail) {
      errorResponse(
        res,
        "Contact ID, Lead Sheet ID and Recipient Email are required",
        400,
      );
      return;
    }

    await sendLeadSheetEmailInDb(id, leadSheetId, recipientEmail, (req as any).user.id);
    successResponse(res, 200, "Lead sheet email sent successfully", null);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const uploadAttachment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!id || !file) {
      errorResponse(res, "Contact ID and File are required", 400);
      return;
    }

    const attachment = await uploadAttachmentInDb(id, file);
    successResponse(res, 201, "Attachment uploaded successfully", attachment);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAttachments = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact ID is required", 400);
      return;
    }
    const attachments = await getAttachmentsForContactInDb(id);
    successResponse(res, 200, "Attachments fetched successfully", attachments);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const deleteAttachment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { attachmentId } = req.params;
    if (!attachmentId) {
      errorResponse(res, "Attachment ID is required", 400);
      return;
    }
    await deleteAttachmentFromDb(attachmentId);
    successResponse(res, 200, "Attachment deleted successfully", null);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const moveToDnc = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { phoneIds } = req.body;
    const userId = (req as any).user.id;

    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }

    const result = await moveToDncInDb(id, userId, phoneIds);
    successResponse(res, 200, "Successfully moved to DNC", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const removeFromDnc = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;

    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }

    const result = await removeFromDncInDb(id, userId);
    successResponse(res, 200, "Successfully removed from DNC", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const bulkAssignContactsToList = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { contactIds, listId } = req.body;
    if (!contactIds || !Array.isArray(contactIds) || !listId) {
      errorResponse(res, "Contact IDs (array) and List ID are required", 400);
      return;
    }
    const result = await bulkAssignContactsToListInDb(contactIds, listId);
    successResponse(res, 200, "Contacts assigned to list successfully", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const bulkAssignContactsToFolder = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { contactIds, folderId, mode = "add" } = req.body;
    if (!contactIds || !Array.isArray(contactIds)) {
      errorResponse(res, "Contact IDs (array) are required", 400);
      return;
    }
    if (!folderId) {
      errorResponse(res, "Folder ID is required", 400);
      return;
    }

    await bulkAssignContactsToFolderInDb(contactIds, folderId, mode);

    successResponse(res, 200, "Contacts assigned to folder successfully", { success: true });
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getContactsByFolder = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { fid } = req.params;
    const { id: userId, role } = (req as any).user;
    if (!fid) {
      errorResponse(res, "Folder id is required", 400);
      return;
    }
    const contacts = await getContactsByFolderFromDb(fid, userId, role);
    successResponse(res, 200, "Contacts fetched by folder", contacts);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const bulkMoveToDnc = async (req: Request, res: Response): Promise<void> => {
  try {
    const { contactIds } = req.body;
    const userId = (req as any).user.id;

    if (!contactIds || !Array.isArray(contactIds)) {
      errorResponse(res, "Contact ids (array) is required", 400);
      return;
    }

    const result = await bulkMoveToDncInDb(contactIds, userId);
    successResponse(res, 200, "Successfully moved to DNC", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getDncList = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const dncList = await getDncListFromDb((req as any).user.id);
    successResponse(res, 200, "DNC list fetched", dncList);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const importContacts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      contactListId,
      contactGroupId,
      contactFolderId,
      fieldMappings: fieldMappingsRaw,
      miscMappings: miscMappingsRaw,
      dupScope: dupScopeRaw,
      dupFields: dupFieldsRaw,
      dupHandling,
    } = req.body;

    const file = req.file;

    if (!contactListId && !contactGroupId && !contactFolderId) {
      errorResponse(res, "List, Group, or Folder ID not provided", 400);
      return;
    }
    if (!file) {
      errorResponse(res, "File is required", 400);
      return;
    }

    // ── Parse fieldMappings
    let fieldMappings: Record<string, string> = {};
    try {
      fieldMappings =
        typeof fieldMappingsRaw === "string"
          ? JSON.parse(fieldMappingsRaw)
          : fieldMappingsRaw || {};
    } catch {
      errorResponse(res, "Invalid fieldMappings format", 400);
      return;
    }

    // ── Parse miscMappings
    let miscMappings: Record<string, string> = {};
    try {
      miscMappings =
        typeof miscMappingsRaw === "string"
          ? JSON.parse(miscMappingsRaw)
          : miscMappingsRaw || {};
    } catch { /* non-critical */ }

    // ── Parse duplicate settings
    let dupScope: string[] = ["Entire Database", "File Import"];
    let dupFields: string[] = ["Phone"];
    try {
      if (dupScopeRaw) dupScope = typeof dupScopeRaw === "string" ? JSON.parse(dupScopeRaw) : dupScopeRaw;
      if (dupFieldsRaw) dupFields = typeof dupFieldsRaw === "string" ? JSON.parse(dupFieldsRaw) : dupFieldsRaw;
    } catch { /* use defaults */ }

    const normalizedDupHandling = dupHandling || "Keep Old";
    const keepOld = normalizedDupHandling === "Keep Old";

    // ── Parse File (CSV or Excel) ─────────────────────────────────────────────
    let records: any[] = [];
    const fileExtension = file.originalname.split(".").pop()?.toLowerCase();

    if (!file.buffer) {
      errorResponse(res, "Uploaded file data is missing", 400);
      return;
    }

    if (fileExtension === "csv") {
      const fileContent = file.buffer.toString("utf-8");
      records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } else if (fileExtension === "xlsx" || fileExtension === "xls") {
      const workbook = xlsx.read(file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Find the first non-empty row to use as the header row
      const allRows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      const headerRowIndex = allRows.findIndex(row => 
        row && Array.isArray(row) && row.some(cell => cell !== null && cell !== undefined && cell.toString().trim() !== "")
      );

      if (headerRowIndex === -1) {
        errorResponse(res, "No data found in the Excel file.", 400);
        return;
      }

      // Use the detected header row index as the starting point (range)
      records = xlsx.utils.sheet_to_json(sheet, { range: headerRowIndex });
    } else {
      errorResponse(res, "Unsupported file format. Please upload CSV or Excel.", 400);
      return;
    }


    // ── Helpers
    const resolve = (record: any, slingvoKey: string): string => {
      const csvCol = fieldMappings[slingvoKey];
      if (!csvCol) return "";
      return (record[csvCol]?.toString() || "").trim();
    };

    const getMappedSlotCount = (prefix: "phone" | "email", minimum: number): number => {
      return Object.keys(fieldMappings).reduce((max, key) => {
        const match = key.match(new RegExp(`^${prefix}_(\\d+)$`));
        return match ? Math.max(max, Number(match[1])) : max;
      }, minimum);
    };

    const phoneSlotCount = getMappedSlotCount("phone", 6);
    const emailSlotCount = getMappedSlotCount("email", 4);

    // ── Map records → contacts
    const contacts = records
      .filter((r) => {
        const fullName = resolve(r, "fullName").toLowerCase();
        const firstName = resolve(r, "firstName").toLowerCase();
        const lastName = resolve(r, "lastName").toLowerCase();
        // Skip header-like rows
        if (fullName === "fullname" || fullName === "full name" || fullName === "name") return false;
        if (firstName === "first name" || firstName === "firstname") return false;
        // Keep if any name field has a value
        return fullName !== "" || firstName !== "" || lastName !== "";
      })
      .map((r) => {
        // ── Name: prefer fullName, fall back to firstName + lastName
        const fullNameVal = resolve(r, "fullName");
        const firstNameVal = resolve(r, "firstName");
        const lastNameVal = resolve(r, "lastName");
        const fullName = fullNameVal
          ? fullNameVal
          : `${firstNameVal} ${lastNameVal}`.trim() || "Unnamed";

        // ── Phones: phone_1 through phone_7
        const phones: { number: string; type: string; isPrimary: boolean }[] = [];
        for (let i = 1; i <= phoneSlotCount; i++) {
          const val = resolve(r, `phone_${i}`);
          if (val) {
            phones.push({ number: val, type: "MOBILE", isPrimary: i === 1 });
          }
        }
        // Also auto-discover unmapped phone columns (backward compat)
        const mappedPhoneCols = new Set(
          Array.from({length: phoneSlotCount}, (_, i) => fieldMappings[`phone_${i+1}`]).filter(Boolean)
        );
        const seenNumbers = new Set(phones.map(p => p.number));
        Object.keys(r).forEach((col) => {
          const lowerCol = col.toLowerCase();
          // Treat a column as a phone column only if its NAME looks like a phone
          // field — but NOT a DNC flag column (e.g. "phone1 DNC") and NOT an id
          // column (e.g. "contactid"). We deliberately do NOT match on "contact"
          // because that pulls in "contactid".
          const isPhoneKeyword =
            (lowerCol.includes("phone") || lowerCol.includes("mobile") || lowerCol.includes("cell")) &&
            !lowerCol.includes("dnc");
          if (isPhoneKeyword && !mappedPhoneCols.has(col)) {
            const val = r[col]?.toString().trim();
            // Require something that actually looks like a phone number (≥ 7 digits)
            // so flag values like "Y"/"N" never get stored as phone numbers.
            if (val && val.replace(/\D/g, "").length >= 7 && !seenNumbers.has(val)) {
              phones.push({ number: val, type: "MOBILE", isPrimary: phones.length === 0 });
              seenNumbers.add(val);
            }
          }
        });

        // ── Emails: email_1 through email_5
        const emails: { email: string; isPrimary: boolean }[] = [];
        for (let i = 1; i <= emailSlotCount; i++) {
          const val = resolve(r, `email_${i}`);
          if (val) {
            emails.push({ email: val, isPrimary: i === 1 });
          }
        }
        // Also auto-discover unmapped email columns
        const mappedEmailCols = new Set(
          Array.from({length: emailSlotCount}, (_, i) => fieldMappings[`email_${i+1}`]).filter(Boolean)
        );
        const seenEmails = new Set(emails.map(e => e.email));
        Object.keys(r).forEach((col) => {
          if (col.toLowerCase().includes("email") && !mappedEmailCols.has(col)) {
            const val = r[col]?.toString().trim();
            if (val && !seenEmails.has(val)) {
              emails.push({ email: val, isPrimary: emails.length === 0 });
              seenEmails.add(val);
            }
          }
        });

        const tagsVal = resolve(r, "tags");
        const tags = tagsVal
          ? tagsVal.split(/[,;|]/).map((t: string) => t.trim()).filter(Boolean)
          : [];

        const miscValues: Record<string, string> = {};
        for (const [miscFieldId, csvCol] of Object.entries(miscMappings)) {
          const val = (r[csvCol]?.toString() || "").trim();
          if (val) miscValues[miscFieldId] = val;
        }

        return {
          fullName,
          address: resolve(r, "address"),
          city: resolve(r, "city"),
          state: resolve(r, "state"),
          zip: resolve(r, "zip"),
          mailingAddress: resolve(r, "mailingAddress"),
          mailingAddress2: resolve(r, "mailingAddress2"),
          mailingCity: resolve(r, "mailingCity"),
          mailingState: resolve(r, "mailingState"),
          mailingZip: resolve(r, "mailingZip"),
          source: resolve(r, "source") || fileExtension?.toUpperCase() + " Import",
          description: resolve(r, "description") || resolve(r, "notes"), // "notes" key kept for backward-compat
          tags,
          emails,
          phones,
          miscValues: Object.keys(miscValues).length > 0 ? miscValues : undefined,
        };
      });

    // ── Call service
    const result = await importContactsInDb({
      userId: (req as any).user.id,
      fileName: file.originalname,
      type: fileExtension?.toUpperCase() || "FILE",
      contactListId:
        !contactListId || contactListId === "null" || contactListId === "undefined"
          ? undefined : contactListId,
      contactGroupId:
        !contactGroupId || contactGroupId === "null" || contactGroupId === "undefined"
          ? undefined : contactGroupId,
      contactFolderId:
        !contactFolderId || contactFolderId === "null" || contactFolderId === "undefined"
          ? undefined : contactFolderId,
      keepOld,
      duplicateConfig: {
        scope: dupScope,
        fields: dupFields,
        handling: normalizedDupHandling,
      },
      contacts,
    });

    successResponse(res, 201, "Contacts imported successfully", result);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getAllImportContacts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const imports = await getAllImportContactsFromDb(userId);
    successResponse(res, 200, "Import history fetched", imports);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const exportContactCsv = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { fieldNames, listId, groupId } = req.body;
    const userId = (req as any).user.id;

    if (!fieldNames || !Array.isArray(fieldNames) || fieldNames.length === 0) {
      errorResponse(res, "Export fields are required", 400);
      return;
    }

    const result = await exportContactsInDb({
      userId,
      fieldNames,
      contactListId: listId,
      contactGroupId: groupId,
    });

    successResponse(res, 201, "Export record created", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAllExportContacts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const exports = await getAllExportContactsFromDb(userId);
    successResponse(res, 200, "Export history fetched", exports);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAllBackupContacts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const role = (req as any).user.role;
    const backups = await getAllBackupContactsFromDb(userId, role);
    successResponse(res, 200, "Backup contacts fetched successfully", backups);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getHotlist = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const role = (req as any).user.role;
    const hotlist = await getHotlistFromDb(userId, role);
    successResponse(res, 200, "Hotlist fetched successfully", hotlist);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const sendTemplateEmail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { templateId } = req.body;
    if (!id || !templateId) {
      errorResponse(res, "Contact ID and Template ID are required", 400);
      return;
    }
    await sendTemplateEmailInDb(id, templateId, (req as any).user.id);
    successResponse(res, 200, "Email sent successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const scheduleTemplateEmail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { templateId, scheduledAt } = req.body;
    if (!id || !templateId || !scheduledAt) {
      errorResponse(res, "Contact ID, Template ID and Schedule Date are required", 400);
      return;
    }
    await scheduleTemplateEmailInDb(id, templateId, scheduledAt);
    successResponse(res, 200, "Email scheduled successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const bulkDeleteContacts = async (req: Request, res: Response) => {
  try {
    let { contactIds, folderId, listId, hardDelete } = req.body;

    if (!contactIds || !Array.isArray(contactIds)) {
      errorResponse(res, "contactIds (array) is required", 400);
      return;
    }

    const userId = (req as any).user.id;
    const referer = req.headers.referer;

    // Smart Context Inference: Fallback to Referer for bulk delete bar
    if (!folderId && referer) {
      const match = referer.match(/\/contacts-folder\/([^\/\s\?]+)/);
      if (match) folderId = match[1];
    }

    const result = await bulkDeleteContactsInDb(userId, contactIds, {
      folderId,
      listId,
      hardDelete: hardDelete === true || hardDelete === "true"
    });

    successResponse(res, 200, "Bulk operation completed successfully", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500
    );
  }
};

export const mergeContacts = async (req: Request, res: Response) => {
  try {
    const { masterId, duplicateIds, targetFolderId, targetListId } = req.body;
    const userId = (req as any).user.id;

    if (!masterId || !duplicateIds || !Array.isArray(duplicateIds) || (!targetFolderId && !targetListId)) {
      errorResponse(res, "masterId, duplicateIds (array), and at least one destination (targetFolderId or targetListId) are required", 400);
      return;
    }

    const result = await mergeContactsInDb(userId, masterId, duplicateIds, targetFolderId, targetListId);
    successResponse(res, 200, "Contacts merged and moved successfully", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500
    );
  }
};
