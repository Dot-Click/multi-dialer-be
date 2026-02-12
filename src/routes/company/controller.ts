import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import { createCompanySchema, updateCompanySchema } from "../../schemas/company.schema";
import {
    createCompanyInDb,
    deleteCompanyFromDb,
    getAllCompaniesFromDb,
    getCompanyByIdFromDb,
    updateCompanyInDb,
} from "./service";

export const createCompany = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, "User not authenticated", 401);
            return;
        }

        const payload = { ...req.body };
        const result = (await validateData(createCompanySchema, payload)) as any;
        if (!("data" in result)) {
            errorResponse(res, "Validation error", 400);
            return;
        }

        const company = await createCompanyInDb({ ...result.data, userId });
        successResponse(res, 201, "Company created successfully", company);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const getAllCompanies = async (req: Request, res: Response): Promise<void> => {
    try {
        const companies = await getAllCompaniesFromDb();
        successResponse(res, 200, "Companies fetched successfully", companies);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const getCompanyById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        if (!id) {
            errorResponse(res, "Company ID is required", 400);
            return;
        }
        const company = await getCompanyByIdFromDb(id);
        successResponse(res, 200, "Company fetched successfully", company);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const updateCompany = async (req: Request, res: Response): Promise<void> => {
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
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const deleteCompany = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        if (!id) {
            errorResponse(res, "Company ID is required", 400);
            return;
        }
        await deleteCompanyFromDb(id);
        successResponse(res, 200, "Company deleted successfully", null);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};
