import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertRecordingInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateRecordingSchema } from "../../../schemas/recording.schema";
import fs from "fs";
import path from "path";

export const getAllRecordingsOfSpecificUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const recordings = await prisma.recording.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    successResponse(res, 200, "Recordings fetched", recordings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllRecordingsOfAllUsers = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const recordings = await prisma.recording.findMany({
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    successResponse(res, 200, "All recordings fetched", recordings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getRecordingById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const recording = await prisma.recording.findFirst({
      where: { id, userId },
    });

    if (!recording) {
      errorResponse(res, "Recording not found", 404);
      return;
    }

    successResponse(res, 200, "Recording fetched", recording);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createRecording = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;

    // user existence check
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) {
      errorResponse(res, "User not found", 404);
      return;
    }

    if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
      errorResponse(
        res,
        {
          errors: [
            {
              expected: "object",
              code: "invalid_type",
              path: ["body"],
              message: "Request body is required and must be a valid JSON object",
            },
          ],
        },
        400
      );
      return;
    }

    const payload = { ...req.body };
    const file = req.file;
    const newRecording = await insertRecordingInDb(payload, userId, file);

    successResponse(res, 201, "Recording created", newRecording);
  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};

export const updateRecording = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const recording = await prisma.recording.findUnique({ where: { id } });
    if (!recording) {
      errorResponse(res, "Recording not found", 404);
      return;
    }

    if (recording.userId !== userId) {
      errorResponse(res, "You can only update your own recordings", 403);
      return;
    }

    // Validate payload fields
    const payload = { ...req.body };
    const result = (await validateData(updateRecordingSchema, payload)) as any;

    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    const data = result.data;

    // Build update object
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.slot !== undefined) updateData.slot = data.slot;

    // Handle file upload if present
    const file = req.file;
    if (file) {
      // upload to cloudinary
      const filePath = path.join("./uploads", file.filename);
      // manual upload so we can specify folder
      const { v2: cloudinary } = await import("cloudinary");
      const cloudResult = await cloudinary.uploader.upload(filePath, {
        resource_type: "auto",
        folder: "recordings",
      });
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      if (!cloudResult || !cloudResult.secure_url) {
        throw new Error("Failed to upload file to Cloudinary");
      }

      updateData.url = cloudResult.secure_url;
      updateData.fileSize = file.size;
      updateData.mimeType = file.mimetype;
      updateData.name = updateData.name || file.originalname; // optionally override name
    }

    if (Object.keys(updateData).length === 0) {
      errorResponse(res, "No fields provided to update", 400);
      return;
    }

    const updated = await prisma.recording.update({
      where: { id },
      data: updateData,
    });

    successResponse(res, 200, "Recording updated", updated);
  } catch (error: any) {
    if (error.code === "P2025") {
      errorResponse(res, "Recording not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteRecording = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const recording = await prisma.recording.findUnique({ where: { id } });
    if (!recording) {
      errorResponse(res, "Recording not found", 404);
      return;
    }

    if (recording.userId !== userId) {
      errorResponse(res, "You can only delete your own recordings", 403);
      return;
    }

    await prisma.recording.delete({ where: { id } });
    successResponse(res, 200, "Recording deleted");
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
