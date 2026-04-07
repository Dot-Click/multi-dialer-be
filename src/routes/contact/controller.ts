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
  importContactsFromCsvInDb,
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
} from "./service";
import {
  createContactListSchema,
  updateContactListSchema,
} from "../../schemas/contactlist.schema";
import { parse } from "csv-parse/sync";
import fs from "fs";

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

    const updated = await updateContactInDb(id, result.data);
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
    const { restore, delete: deleteQuery } = req.query;

    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }

    if (restore === "true") {
      await restoreContactFromDb(id, (req as any).user.id);
      successResponse(res, 200, "Contact restored successfully", null);
    } else if (deleteQuery === "true") {
      await permanentlyDeleteContactFromDb(id, (req as any).user.id);
      successResponse(
        res,
        200,
        "Contact permanently deleted successfully",
        null,
      );
    } else {
      await deleteContactFromDb(id, (req as any).user.id);
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
    const contactFolders = await getAllContactFoldersFromDb(
      (req as any).user.id,
      (req as any).user.role,
    );
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
    const { contactIds, folderId } = req.body;
    if (!contactIds || !Array.isArray(contactIds)) {
      errorResponse(res, "Contact IDs (array) are required", 400);
      return;
    }

    // folderId can be null to move to Root
    for (const id of contactIds) {
      await assignContactToFolderInDb(id, folderId || null);
    }

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
    const dncList = await getDncListFromDb();
    successResponse(res, 200, "DNC list fetched", dncList);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const importContactCsv = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      contactListId,
      contactGroupId,
      fieldMappings: fieldMappingsRaw,
      miscMappings: miscMappingsRaw,       // ← NEW
      dupScope: dupScopeRaw,
      dupFields: dupFieldsRaw,
      dupHandling,
    } = req.body;
 
    const file = req.file;
 
    if (!contactListId && !contactGroupId) {
      errorResponse(res, "List or Group ID not provided", 400);
      return;
    }
    if (!file) {
      errorResponse(res, "CSV file is required", 400);
      return;
    }
 
    // ── Parse fieldMappings (primary fields) ──────────────────────────────────
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
 
    // ── Parse miscMappings { "<MiscField.id>": "<csvColumnHeader>" } ──────────
    let miscMappings: Record<string, string> = {};
    try {
      miscMappings =
        typeof miscMappingsRaw === "string"
          ? JSON.parse(miscMappingsRaw)
          : miscMappingsRaw || {};
    } catch {
      // non-critical
    }
 
    // ── Parse duplicate settings ──────────────────────────────────────────────
    let dupScope: string[]  = ["Entire Database", "File Import"];
    let dupFields: string[] = ["Phone"];
    try {
      if (dupScopeRaw)  dupScope  = typeof dupScopeRaw  === "string" ? JSON.parse(dupScopeRaw)  : dupScopeRaw;
      if (dupFieldsRaw) dupFields = typeof dupFieldsRaw === "string" ? JSON.parse(dupFieldsRaw) : dupFieldsRaw;
    } catch { /* use defaults */ }
 
    const normalizedDupHandling = dupHandling || "Keep Old";
    const keepOld = normalizedDupHandling === "Keep Old";
 
    // ── Parse CSV ─────────────────────────────────────────────────────────────
    const fileContent = fs.readFileSync(file.path, "utf-8");
    const records: Record<string, string>[] = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
 
    try { fs.unlinkSync(file.path); } catch (e) { console.error("Temp file cleanup error:", e); }
 
    // ── Helpers ───────────────────────────────────────────────────────────────
 
    // Resolve a primary field value: fieldMappings["Name"] = "full_name" → record["full_name"]
    const resolve = (record: Record<string, string>, systemField: string): string => {
      const csvCol = fieldMappings[systemField];
      if (!csvCol) return "";
      return (record[csvCol] || "").trim();
    };
 
    // ── Map records → contacts ────────────────────────────────────────────────
    const contacts = records
      .filter((r) => {
        const name = resolve(r, "Name").toLowerCase();
        return name !== "fullname" && name !== "full name" && name !== "name" && name !== "";
      })
      .map((r) => {
        // Emails
        const emails: { email: string; isPrimary: boolean }[] = [];
        const emailVal = resolve(r, "Email");
        if (emailVal) {
          emailVal.split(",").forEach((e, idx) => {
            const trimmed = e.trim();
            if (trimmed) emails.push({ email: trimmed, isPrimary: idx === 0 });
          });
        }
 
        // Phones
        const phones: { number: string; type: string }[] = [];
        const phoneVal = resolve(r, "Phone");
        if (phoneVal) {
          phones.push({ number: phoneVal.toString(), type: "MOBILE" });
        }
 
        // Tags
        const tagsVal = resolve(r, "Tags");
        const tags = tagsVal
          ? tagsVal.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
 
        // ── Misc values — keyed by MiscField.id ──────────────────────────────
        // miscMappings = { "3ccbf011-...": "dob_column", "ab12cd-...": "notes_col" }
        // We read the CSV column value for each mapped misc field
        const miscValues: Record<string, string> = {};
        for (const [miscFieldId, csvCol] of Object.entries(miscMappings)) {
          const val = (r[csvCol] || "").trim();
          if (val) miscValues[miscFieldId] = val;
          // Result: { "3ccbf011-416f-4716-8934-3cb5fbf75490": "1990-01-01" }
        }
 
        return {
          fullName: resolve(r, "Name") || "Unnamed",
          address:  "",
          city:     "",
          state:    "",
          zip:      "",
          source:   "CSV Import",
          notes:    "",
          tags,
          emails,
          phones,
          // Only set miscValues if there's actually something to save
          miscValues: Object.keys(miscValues).length > 0 ? miscValues : undefined,
        };
      });
 
    // ── Call service ──────────────────────────────────────────────────────────
    const result = await importContactsFromCsvInDb({
      userId: (req as any).user.id,
      fileName: file.originalname,
      type: "CSV",
      contactListId:
        !contactListId || contactListId === "null" || contactListId === "undefined"
          ? undefined : contactListId,
      contactGroupId:
        !contactGroupId || contactGroupId === "null" || contactGroupId === "undefined"
          ? undefined : contactGroupId,
      keepOld,
      duplicateConfig: {
        scope:    dupScope,
        fields:   dupFields,
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
