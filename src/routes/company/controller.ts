import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import {
  createCompanySchema,
  updateCompanySchema,
} from "../../schemas/company.schema";
import {
  createCompanyInDb,
  deleteCompanyFromDb,
  getAllCompaniesFromDb,
  getCompanyByIdFromDb,
  updateCompanyInDb,
} from "./service";

export const createCompany = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const payload = { ...req.body };

    // Check if company already exists
    const existing = await prisma.company.findFirst({
      where: { userId },
    });

    // If updating, use partial schema. If new, use full schema but default the name.
    const schema = existing ? updateCompanySchema : createCompanySchema;
    
    if (!existing && !payload.companyName) {
      payload.companyName = "My Business";
    }

    const result = (await validateData(schema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const company = await createCompanyInDb({
      ...result.data,
      userId: userId,
    });
    successResponse(res, 201, "Company processed successfully", company);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getAllCompanies = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const companies = await getAllCompaniesFromDb();
    successResponse(res, 200, "Companies fetched successfully", companies);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getCompanyById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Company ID is required", 400);
      return;
    }
    const company = await getCompanyByIdFromDb(id);
    successResponse(res, 200, "Company fetched successfully", company);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const updateCompany = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Company ID is required", 400);
      return;
    }

    const payload = { ...req.body };
    const result = (await validateData(updateCompanySchema, payload)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const updatedCompany = await updateCompanyInDb(id, result.data);
    successResponse(res, 200, "Company updated successfully", updatedCompany);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const deleteCompany = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      errorResponse(res, "Company ID is required", 400);
      return;
    }
    await deleteCompanyFromDb(id);
    successResponse(res, 200, "Company deleted successfully", null);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const getMyCompany = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const company = await prisma.company.findFirst({
      where: { userId },
    });
    successResponse(res, 200, "My company fetched successfully", company);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};
