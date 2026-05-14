import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { getAuditLogsFromDb } from "../../../utils/audit";

export const getAuditLogs = async (req: Request, res: Response) => {
    try {
        const { id: userId, role } = req.user!;

        console.log(role)
        const logs = await getAuditLogsFromDb(userId, role, 100);
        successResponse(res, 200, "Audit logs fetched", logs);
    } catch (error: any) {
        errorResponse(res, error.message || "Internal server error", 500);
    }
};
