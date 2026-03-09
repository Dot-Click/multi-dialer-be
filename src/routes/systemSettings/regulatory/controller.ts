import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { getRegulatorySettingFromDb, updateRegulatorySettingInDb } from "./service";

export const getRegulatorySetting = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const settings = await getRegulatorySettingFromDb(userId);
        successResponse(res, 200, "Regulatory settings fetched", settings);
    } catch (error: any) {
        errorResponse(res, error.message || "Internal server error", 500);
    }
};

export const updateRegulatorySetting = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const payload = req.body;
        const settings = await updateRegulatorySettingInDb(userId, payload);
        successResponse(res, 200, "Regulatory settings updated", settings);
    } catch (error: any) {
        errorResponse(res, error.message || "Internal server error", 500);
    }
};
