import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createMediaCenterSchema } from "../../../schemas/mediaCenter.schema";
import { cloudinaryUploader } from "../../../utils/handler";
import { Request } from "express";
import fs from "fs";
import path from "path";

// Media type configurations
const MEDIA_CONFIG = {
  VOICE_MAIL: {
    maxDuration: 120, // seconds
    maxFileSize: 20 * 1024 * 1024, // 20 MB
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4", "audio/m4a"],
    fileCategory: "audio" as const,
  },
  ON_HOLD: {
    maxDuration: 20, // seconds
    maxFileSize: 750 * 1024, // 750 KB
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4", "audio/m4a"],
    fileCategory: "audio" as const,
  },
  CALLBACK_MESSAGE: {
    maxDuration: 20, // seconds
    maxFileSize: 750 * 1024, // 750 KB
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4", "audio/m4a"],
    fileCategory: "audio" as const,
  },
  EMAIL_VIDEO: {
    maxDuration: null, // No duration limit
    maxFileSize: 20 * 1024 * 1024, // 20 MB
    allowedMimeTypes: ["video/mp4", "video/mpeg", "video/quicktime", "video/x-msvideo", "video/webm"],
    fileCategory: "video" as const,
  },
};

/**
 * Get file duration using ffprobe or a Node.js library
 * TODO: Implement duration extraction using ffprobe or get-audio-duration library
 * For now, returns null - duration validation will be skipped
 */
async function getFileDuration(filePath: string, mimeType: string): Promise<number | null> {
  // Placeholder for duration extraction
  // In production, use:
  // - For audio: get-audio-duration library or ffprobe
  // - For video: ffprobe
  // Example with get-audio-duration:
  // const getDuration = require('get-audio-duration');
  // return await getDuration(filePath);
  
  return null; // Return null for now - can be implemented later
}

export async function insertMediaCenterInDb(payload: any, userId: string, file: Express.Multer.File | undefined) {
  try {
    // Validate payload with Zod
    const result = await validateData(createMediaCenterSchema, payload) as any;

    if (!('data' in result)) {
      throw { errors: result };
    }

    const data = result.data;

    // Validate file exists
    if (!file) {
      throw { errors: [{ message: "File is required", path: ["file"] }] };
    }

    // Get media type configuration
    const config = MEDIA_CONFIG[data.mediaType as keyof typeof MEDIA_CONFIG];
    if (!config) {
      throw { errors: [{ message: "Invalid media type", path: ["mediaType"] }] };
    }

    // Validate file type
    if (!config.allowedMimeTypes.includes(file.mimetype)) {
      throw {
        errors: [
          {
            message: `Invalid file type for ${data.mediaType}. Allowed types: ${config.allowedMimeTypes.join(", ")}`,
            path: ["file"],
          },
        ],
      };
    }

    // Validate file size
    if (file.size > config.maxFileSize) {
      const maxSizeMB = config.maxFileSize / (1024 * 1024);
      throw {
        errors: [
          {
            message: `File size exceeds maximum allowed size of ${maxSizeMB}MB for ${data.mediaType}`,
            path: ["file"],
          },
        ],
      };
    }

    // Get or create user's library
    let library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      library = await prisma.library.create({
        data: {
          userId,
        },
      });
    }

    // Get file path for duration check and Cloudinary upload
    const filePath = path.join("./uploads", file.filename);

    // Get file duration (if required)
    let duration: number | null = null;
    if (config.maxDuration !== null && config.fileCategory === "audio") {
      // Only validate duration for audio files that require it
      duration = await getFileDuration(filePath, file.mimetype);
      
      if (duration !== null && duration > config.maxDuration) {
        // Clean up local file before throwing error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        throw {
          errors: [
            {
              message: `File duration (${duration}s) exceeds maximum allowed duration of ${config.maxDuration}s for ${data.mediaType}`,
              path: ["file"],
            },
          ],
        };
      }
    }

    // Upload file to Cloudinary with appropriate resource type
    let cloudinaryResult;
    try {
      // Determine resource type based on file category
      const resourceType = config.fileCategory === "video" ? "video" : "auto";
      
      // Import cloudinary directly for custom upload options
      const { v2: cloudinary } = await import("cloudinary");
      
      cloudinaryResult = await cloudinary.uploader.upload(filePath, {
        resource_type: resourceType,
        folder: "media-center", // Organize files in Cloudinary folder
      });
      
      if (!cloudinaryResult || !cloudinaryResult.secure_url) {
        throw new Error("Failed to upload file to Cloudinary");
      }
    } catch (cloudinaryError: any) {
      // Clean up local file if Cloudinary upload fails
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw {
        errors: [
          {
            message: `Failed to upload file to Cloudinary: ${cloudinaryError.message || "Unknown error"}`,
            path: ["file"],
          },
        ],
      };
    }

    // Delete local file after successful Cloudinary upload
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Use Cloudinary URL
    const fileUrl = cloudinaryResult.secure_url;
    const fileName = cloudinaryResult.public_id || file.filename;

    // Insert MediaCenter into DB with libraryId
    const mediaCenter = await prisma.mediaCenter.create({
      data: {
        templateName: data.templateName,
        mediaType: data.mediaType,
        fileName: fileName,
        fileUrl: fileUrl,
        fileSize: file.size,
        duration: duration,
        fileCategory: config.fileCategory,
        libraryId: library.id,
      },
    });

    return mediaCenter;
  } catch (error) {
    // Clean up uploaded file if there's an error
    if (file && file.filename) {
      const filePath = path.join("./uploads", file.filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkError) {
          console.error("Error deleting local file:", unlinkError);
        }
      }
    }
    throw error;
  }
}

