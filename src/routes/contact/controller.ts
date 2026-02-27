import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import { createContactGroupSchema, createContactSchema, createListFolderSchema, updateContactSchema } from "../../schemas/contact.schema";
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
} from "./service";
import { createContactListSchema } from "@/schemas/contactlist.schema";

export const createContact = async (req: Request, res: Response): Promise<void> => {
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
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getAllContacts = async (req: Request, res: Response): Promise<void> => {
  try {
    const contacts = await getAllContactsFromDb();
    successResponse(res, 200, "Contacts fetched", contacts);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getContactById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }
    const contact = await getContactByIdFromDb(id);
    successResponse(res, 200, "Contact fetched", contact);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const updateContact = async (req: Request, res: Response): Promise<void> => {
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
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const deleteContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact id is required", 400);
      return;
    }
    await deleteContactFromDb(id);
    successResponse(res, 200, "Contact deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};


export const createContactList = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(createContactListSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const contactList = await createContactListInDb(result.data);
    successResponse(res, 201, "Contact list created", contactList);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const updateContactList = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact list id is required", 400);
      return;
    }
    const payload = { ...req.body };
    const result = (await validateData(createContactListSchema.partial(), payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updated = await updateContactListInDb(id, result.data);
    successResponse(res, 200, "Contact list updated", updated);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const createContactFolder = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(createListFolderSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const contactFolder = await createContactFolderInDb(result.data);
    successResponse(res, 201, "Contact folder created", contactFolder);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const updateContactFolder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact folder id is required", 400);
      return;
    }
    const payload = { ...req.body };
    const result = (await validateData(createListFolderSchema.partial(), payload)) as any;

    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updated = await updateContactFolderInDb(id, result.data);
    successResponse(res, 200, "Contact folder updated", updated);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};


export const createContactGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(createContactGroupSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const contactGroup = await createContactGroupInDb(result.data);
    successResponse(res, 201, "Contact group created", contactGroup);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const updateContactGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact group id is required", 400);
      return;
    }
    const payload = { ...req.body };
    const result = (await validateData(createContactGroupSchema.partial(), payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updated = await updateContactGroupInDb(id, result.data);
    successResponse(res, 200, "Contact group updated", updated);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const deleteContactList = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact list id is required", 400);
      return;
    }
    await deleteContactListFromDb(id);
    successResponse(res, 200, "Contact list deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const deleteContactFolder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact folder id is required", 400);
      return;
    }
    await deleteContactFolderFromDb(id);
    successResponse(res, 200, "Contact folder deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const deleteContactGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Contact group id is required", 400);
      return;
    }
    await deleteContactGroupFromDb(id);
    successResponse(res, 200, "Contact group deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};


export const getAllContactLists = async (req: Request, res: Response): Promise<void> => {
  try {
    const contactLists = await getAllContactListsFromDb();
    successResponse(res, 200, "Contact lists fetched", contactLists);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getAllContactFolders = async (req: Request, res: Response): Promise<void> => {
  try {
    const contactFolders = await getAllContactFoldersFromDb();
    successResponse(res, 200, "Contact folders fetched", contactFolders);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getAllContactGroups = async (req: Request, res: Response): Promise<void> => {
  try {
    const contactGroups = await getAllContactGroupsFromDb();
    successResponse(res, 200, "Contact groups fetched", contactGroups);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};


export const getContactsByList = async (req: Request, res: Response): Promise<void> => {
  try {
    const { lid } = req.params;
    if (!lid) {
      errorResponse(res, "Contact list id is required", 400);
      return;
    }
    const contacts = await getContactsByListFromDb(lid);
    successResponse(res, 200, "Contacts fetched", contacts);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};



