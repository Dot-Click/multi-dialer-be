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
  getAllImportContactsFromDb,
  importContactsFromCsvInDb,
} from "./service";
import { createContactListSchema } from "@/schemas/contactlist.schema";
import fs from "fs";
import { parse } from "csv-parse/sync";

export const createContact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(createContactSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const contact = await createContactInDb(result.data);
    successResponse(res, 201, "Contact created", contact);
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
    const contacts = await getAllContactsFromDb();
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

export const deleteContact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }
    await deleteContactFromDb(id);
    successResponse(res, 200, "Contact deleted successfully", null);
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
      createContactListSchema.partial(),
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
    const contactLists = await getAllContactListsFromDb((req as any).user.id);
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
    const contactGroups = await getAllContactGroupsFromDb((req as any).user.id);
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
    const contacts = await getContactsByListFromDb(lid);
    successResponse(res, 200, "Contacts fetched", contacts);
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
    const { contactListId, contactGroupId, keepOld, type, fileName } = req.body;
    const file = req.file;

    if (!contactListId && !contactGroupId) {
      errorResponse(res, "List or Group ID not provided", 400);
      return;
    }

    if (!file) {
      errorResponse(res, "CSV file is required", 400);
      return;
    }

    const fileContent = fs.readFileSync(file.path, "utf-8");
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Cleanup uploaded file
    try {
      fs.unlinkSync(file.path);
    } catch (cleanupErr) {
      console.error("Error deleting temp file:", cleanupErr);
    }

    // Map records to formatted contacts
    const contacts = records.map((r: any) => {
      const emails = [];
      if (r.primary_email) {
        emails.push({ email: r.primary_email, isPrimary: true });
      }
      if (r.other_emails) {
        const others = r.other_emails.split(",").map((e: string) => ({
          email: e.trim(),
          isPrimary: false,
        }));
        emails.push(...others);
      }

      const phones = [];
      if (r.phone_mobile) {
        phones.push({ number: r.phone_mobile.toString(), type: "MOBILE" });
      }
      if (r.phone_telephone) {
        phones.push({
          number: r.phone_telephone.toString(),
          type: "TELEPHONE",
        });
      }
      if (r.phone_home) {
        phones.push({ number: r.phone_home.toString(), type: "HOME" });
      }
      if (r.phone_work) {
        phones.push({ number: r.phone_work.toString(), type: "WORK" });
      }

      return {
        fullName: r.fullName || "Unnamed",
        city: r.city || "",
        state: r.state || "",
        zip: r.zip || "",
        source: r.source || "CSV Import",
        tags: r.tags ? r.tags.split(",").map((t: string) => t.trim()) : [],
        notes: r.notes || "",
        emails,
        phones,
      };
    });

    const result = await importContactsFromCsvInDb({
      userId: (req as any).user.id,
      fileName: fileName || file.originalname,
      type: type || "CSV",
      contactListId:
        contactListId === "null" ||
        contactListId === "undefined" ||
        !contactListId
          ? undefined
          : contactListId,
      contactGroupId:
        contactGroupId === "null" ||
        contactGroupId === "undefined" ||
        !contactGroupId
          ? undefined
          : contactGroupId,
      keepOld: keepOld === "true" || keepOld === true,
      contacts,
    });

    successResponse(res, 201, "Contacts imported successfully", result);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
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
