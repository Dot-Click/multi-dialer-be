import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createRecordingSchema } from "../../../schemas/recording.schema";
import fs from "fs";
import path from "path";

export async function insertRecordingInDb(
  payload: any,
  userId: string,
  file: Express.Multer.File | undefined
) {
  try {
    // validate payload
    const result = (await validateData(createRecordingSchema, payload)) as any;
    if (!("data" in result)) {
      throw { errors: result };
    }

    const data = result.data;

    if (!file) {
      throw { errors: [{ message: "File is required", path: ["file"] }] };
    }

    // validate file type and size (audio only)
    const allowedMime = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/mp4",
      "audio/m4a",
    ];

    if (!allowedMime.includes(file.mimetype)) {
      throw {
        errors: [
          {
            message: `Invalid file type. Allowed audio formats: ${allowedMime.join(", ")}`,
            path: ["file"],
          },
        ],
      };
    }

    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      throw {
        errors: [
          {
            message: `File size exceeds maximum of ${maxSize / (1024 * 1024)}MB`,
            path: ["file"],
          },
        ],
      };
    }

    // upload to cloudinary
    const filePath = path.join("./uploads", file.filename);
    // manual import so we can specify folder
    const { v2: cloudinary } = await import("cloudinary");
    const cloudResult = await cloudinary.uploader.upload(filePath, {
      resource_type: "auto",
      folder: "recordings",
    });

    // cleanup local file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (!cloudResult || !cloudResult.secure_url) {
      throw new Error("Failed to upload file to Cloudinary");
    }

    const recording = await prisma.recording.create({
      data: {
        name: data.name,
        url: cloudResult.secure_url,
        fileSize: file.size,
        duration: null,
        mimeType: file.mimetype,
        slot: data.slot || "GENERAL",
        userId,
      },
    });

    return recording;
  } catch (error) {
    // clean up file if any error occurred
    if (file && file.filename) {
      const filePath = path.join("./uploads", file.filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
    }
    throw error;
  }
}
