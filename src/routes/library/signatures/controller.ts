import { Request, Response } from "express";
import { signatureSchema } from "@/schemas/signature.schema";
import { upsertSignature, getSignature } from "./service";

export const saveSignature = async (req: Request, res: Response) => {
    const parsed = signatureSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ errors: parsed.error.flatten() });
        return
    }

    const userId = req.user?.id; // from your auth middleware
    const signature = await upsertSignature(userId!, parsed.data.content);
    res.status(200).json({ signature });
};

export const fetchSignature = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const signature = await getSignature(userId!);
    res.status(200).json({ signature });
};