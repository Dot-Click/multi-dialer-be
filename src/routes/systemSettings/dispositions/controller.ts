import { RequestHandler } from "express";
import { successResponse, errorResponse } from "@/utils/handler";
import { DispositionService } from "./service";
import prisma from "@/lib/prisma";

export const getDispositions: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const dispositions = await DispositionService.getDispositions(userId);
        successResponse(res, 200, "Dispositions fetched", dispositions);
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

export const createDisposition: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const newDisposition = await DispositionService.createDisposition(userId, req.body);
        successResponse(res, 201, "Disposition created", newDisposition);
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

export const updateDisposition: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await DispositionService.updateDisposition(id, req.body);
        successResponse(res, 200, "Disposition updated", updated);
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

export const deleteDisposition: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        await DispositionService.deleteDisposition(id);
        successResponse(res, 200, "Disposition deleted");
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};

export const reorderDispositions: RequestHandler = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            errorResponse(res, { message: "Unauthorized" }, 401);
            return;
        }

        const result = await DispositionService.reorderDispositions(userId, req.body.orderData);
        successResponse(res, 200, "Dispositions reordered", result);
    } catch (error: any) {
        errorResponse(res, { message: error.message });
    }
};
