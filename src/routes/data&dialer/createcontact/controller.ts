import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertContactInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateContactSchema } from "../../../zod/createcontact.schema";

export const createContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    const newContact = await insertContactInDb(req.body, userId);
    successResponse(res, 201, "Contact created successfully", newContact);
  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};

export const getAllContactsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    const contacts = await prisma.createContact.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    successResponse(res, 200, "User contacts fetched", contacts);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getAllContactsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const contacts = await prisma.createContact.findMany({
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    successResponse(res, 200, "All contacts fetched", contacts);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};
// ... (lines 40-45)
export const getContactById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const contact = await prisma.createContact.findUnique({ where: { id } });
    
    // FIX HERE: Added braces and explicit return
    if (!contact) {
      errorResponse(res, "Contact not found", 404);
      return;
    }
    
    successResponse(res, 200, "Contact fetched", contact);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const updateContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await validateData(updateContactSchema, req.body) as any;
    
    // FIX HERE: Added braces and explicit return
    if (!('data' in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    const updated = await prisma.createContact.update({
      where: { id },
      data: result.data
    });
    successResponse(res, 200, "Contact updated", updated);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};
// ...
export const deleteContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.createContact.delete({ where: { id } });
    successResponse(res, 200, "Contact deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};