import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { getAuditLogsFromDb } from "../../../utils/audit";

export const getAuditLogs = async (req: Request, res: Response) => {
    try {
        const logs = await getAuditLogsFromDb();
        successResponse(res, 200, "Audit logs fetched", logs);
    } catch (error: any) {
        errorResponse(res, error.message || "Internal server error", 500);
    }
};
