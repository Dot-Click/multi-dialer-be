import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
 * Parses an R2-hosted URL (path-style: `<host>/<bucket>/<key...>`) back into
 * its bucket + key. Returns null for anything that isn't one of OUR R2 URLs
 * (e.g. a Twilio recording link) — callers must not touch those.
 */
function parseR2Url(storedUrl: string): { bucket: string; key: string } | null {
  try {
    const parsed = new URL(storedUrl);

    const isOurR2 =
      parsed.hostname.endsWith(".r2.cloudflarestorage.com") ||
      (!!envConfig.R2_PUBLIC_URL && parsed.hostname === envConfig.R2_PUBLIC_URL);
    if (!isOurR2) return null;

    const segments = parsed.pathname.replace(/^\/+/, "").split("/");
    const bucket = segments.shift() || envConfig.R2_BUCKET_NAME || "multi-dialer";
    const key = segments.join("/");
    if (!key) return null;

    return { bucket, key };
  } catch {
    return null;
  }
}

/**
 * Generate a short-lived presigned GET URL for an object stored in R2.
 *
 * Recordings (and other private objects) are stored against R2's S3 API
 * endpoint (`<account>.r2.cloudflarestorage.com/<bucket>/<key>`), which rejects
 * unsigned browser requests. The stored `recordingUrl` is therefore not
 * directly playable. This parses the bucket + key back out of that stored URL
 * and returns a signed URL the browser can fetch directly.
 *
 * @param storedUrl - the URL persisted at upload time
 * @param expiresIn - signature lifetime in seconds (default 1 hour)
 * @returns a presigned URL, or the original URL if it can't be parsed/signed
 */
export async function getPresignedUrlFromStoredUrl(
  storedUrl: string | null | undefined,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!storedUrl) return storedUrl ?? null;

  const parsed = parseR2Url(storedUrl);
  // Not one of ours (e.g. a Twilio recording link) — return untouched,
  // otherwise we'd mangle its path into a bogus R2 key and produce a URL
  // that 403s (which surfaces as "no supported sources" in the <audio> player).
  if (!parsed) return storedUrl;

  try {
    const command = new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key });
    return await getSignedUrl(r2, command, { expiresIn });
  } catch (error) {
    console.error("[R2 Presign Error]", error);
    return storedUrl;
  }
}

/**
 * Deletes an object from R2 given the URL that was persisted at upload time.
 * No-ops (and never throws) for URLs that aren't ours (e.g. a raw Twilio
 * link) or that fail to parse — this is best-effort storage cleanup and must
 * never block the caller's primary delete operation.
 */
export async function deleteFromR2(storedUrl: string | null | undefined): Promise<void> {
  if (!storedUrl) return;

  const parsed = parseR2Url(storedUrl);
  if (!parsed) return;

  try {
    await r2.send(new DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
  } catch (error: any) {
    console.error(`[R2 Delete Error] Failed to delete ${storedUrl}:`, error?.message || error);
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
