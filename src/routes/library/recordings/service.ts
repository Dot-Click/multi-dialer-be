import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createRecordingSchema } from "../../../schemas/recording.schema";
import { uploadToR2 } from "../../../utils/r2-uploader";

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

    if (!file || !file.buffer) {
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

    // Upload to R2
    const r2Result = await uploadToR2(file.buffer, file.mimetype, "recordings");

    const recording = await prisma.recording.create({
      data: {
        name: data.name,
        url: r2Result.url,
        fileSize: file.size,
        duration: null,
        mimeType: file.mimetype,
        slot: data.slot || "GENERAL",
        userId,
      },
    });

    return recording;
  } catch (error) {
    throw error;
  }
}
