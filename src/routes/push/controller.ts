import { Request, Response } from "express";
import * as pushService from "./service";
import { successResponse, errorResponse } from "../../utils/handler";

export const subscribe = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) return errorResponse(res, "Unauthorized", 401);

        const subscription = req.body;
        await pushService.saveSubscription(userId, subscription);
        
        return successResponse(res, 200, "Subscribed to push notifications");
    } catch (error) {
        return errorResponse(res, error);
    }
};

export const unsubscribe = async (req: Request, res: Response) => {
    try {
        const { endpoint } = req.body;
        await pushService.removeSubscription(endpoint);
        return successResponse(res, 200, "Unsubscribed from push notifications");
    } catch (error) {
        return errorResponse(res, error);
    }
};
