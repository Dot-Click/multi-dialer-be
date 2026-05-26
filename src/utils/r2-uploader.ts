import { PutObjectCommand } from "@aws-sdk/client-s3";
import r2 from "../lib/config";
import { randomUUID } from "crypto";
import { envConfig } from "../lib/config";

interface R2UploadResult {
  url: string;
  key: string;
}

/**
 * Upload file to Cloudflare R2 storage
 * @param fileBuffer - File buffer from multer
 * @param mimeType - MIME type of the file
 * @param folderName - Folder name in R2 bucket (e.g., "recordings", "media-center")
 * @returns Object containing public URL and key
 */
export async function uploadToR2(
  fileBuffer: Buffer,
  mimeType: string,
  folderName: string = ""
): Promise<R2UploadResult> {
  try {
    // Generate unique file name
    const fileExtension = getFileExtension(mimeType);
    const fileName = `${randomUUID()}${fileExtension}`;
    const key = folderName ? `${folderName}/${fileName}` : fileName;

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: envConfig.R2_BUCKET_NAME || "multi-dialer",
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await r2.send(command);

    // Construct public URL
    const publicUrl = `https://${envConfig.R2_PUBLIC_URL || `${envConfig.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${envConfig.R2_BUCKET_NAME || "multi-dialer"}/${key}`;

    return {
      url: publicUrl,
      key,
    };
  } catch (error) {
    console.error("[R2 Upload Error]", error);
    throw new Error(`Failed to upload file to R2: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    // Audio
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    // Video
    "video/mp4": ".mp4",
    "video/mpeg": ".mpeg",
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/webm": ".webm",
    // Images
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    // Documents
    "text/csv": ".csv",
    "application/pdf": ".pdf",
  };

  return mimeMap[mimeType] || "";
}
