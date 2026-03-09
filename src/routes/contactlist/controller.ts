import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import {
  createContactListSchema,
  updateContactListSchema,
} from "../../schemas/contactlist.schema";
import {
  createListInDb,
  deleteListFromDb,
  getAllListsFromDb,
  getListByIdFromDb,
  updateListInDb,
} from "./service";

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

    const userId = (req as any).user.id;
    const list = await createListInDb(userId, result.data);
    successResponse(res, 201, "List created", list);
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
    const userId = (req as any).user.id;
    const lists = await getAllListsFromDb(userId);
    successResponse(res, 200, "Lists fetched", lists);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getContactListById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "List id is required", 400);
      return;
    }

    const userId = (req as any).user.id;
    const list = await getListByIdFromDb(id, userId);
    successResponse(res, 200, "List fetched", list);
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
      errorResponse(res, "List id is required", 400);
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

    const userId = (req as any).user.id;
    const resultFromDb = await updateListInDb(id, userId, result.data);
    successResponse(res, 200, resultFromDb.message, resultFromDb.list);
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
      errorResponse(res, "List id is required", 400);
      return;
    }
    const userId = (req as any).user.id;
    await deleteListFromDb(id, userId);
    successResponse(res, 200, "List deleted successfully", null);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};
