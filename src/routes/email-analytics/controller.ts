import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import {
  getEmailAnalyticsSummary,
  getEmailTimeline,
  getEmailLogs,
  getDeadLetterQueue,
} from "./service";
import { EmailStatus } from "@prisma/client";

export const getSummary = async (_req: Request, res: Response) => {
  try {
    const data = await getEmailAnalyticsSummary();
    successResponse(res, 200, "Email analytics summary", data);
  } catch (err: any) {
    errorResponse(res, err?.message || "Internal server error", 500);
  }
};

export const getTimeline = async (req: Request, res: Response) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const data = await getEmailTimeline(days);
    successResponse(res, 200, "Email timeline", data);
  } catch (err: any) {
    errorResponse(res, err?.message || "Internal server error", 500);
  }
};

export const getLogs = async (req: Request, res: Response) => {
  try {
    const page   = Math.max(Number(req.query.page)  || 1, 1);
    const limit  = Math.min(Number(req.query.limit) || 20, 100);
    const search = req.query.search as string | undefined;
    const days   = req.query.days ? Math.min(Number(req.query.days), 90) : undefined;

    const rawStatus = req.query.status as string | undefined;
    const status =
      rawStatus === "SENT"   ? EmailStatus.SENT   :
      rawStatus === "FAILED" ? EmailStatus.FAILED :
      undefined;

    const data = await getEmailLogs({ page, limit, status, search, days });
    successResponse(res, 200, "Email logs", data);
  } catch (err: any) {
    errorResponse(res, err?.message || "Internal server error", 500);
  }
};

export const getDeadQueue = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(Number(req.query.page)  || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const data  = await getDeadLetterQueue({ page, limit });
    successResponse(res, 200, "Dead-letter queue", data);
  } catch (err: any) {
    errorResponse(res, err?.message || "Internal server error", 500);
  }
};
