import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import { createContactListSchema, updateContactListSchema } from "../../zod/contactlist.schema";
import { createListInDb, deleteListFromDb, getAllListsFromDb, getListByIdFromDb, updateListInDb } from "./service";

export const createContactList = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = { ...req.body };
    const result = (await validateData(createContactListSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const list = await createListInDb(result.data);
    successResponse(res, 201, "List created", list);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getAllContactLists = async (req: Request, res: Response): Promise<void> => {
  try {
    const lists = await getAllListsFromDb();
    successResponse(res, 200, "Lists fetched", lists);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getContactListById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "List id is required", 400);
      return;
    }

    const list = await getListByIdFromDb(id);
    successResponse(res, 200, "List fetched", list);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const updateContactList = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "List id is required", 400);
      return;
    }

    const payload = { ...req.body };
    const result = (await validateData(updateContactListSchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updated = await updateListInDb(id, result.data);
    successResponse(res, 200, "List updated", updated);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const deleteContactList = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "List id is required", 400);
      return;
    }
    await deleteListFromDb(id);
    successResponse(res, 200, "List deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};


