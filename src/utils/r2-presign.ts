import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import r2, { envConfig } from "../lib/config";

const BUCKET = envConfig.R2_BUCKET_NAME || "multi-dialer";

/**
 * Derive the R2 object key from a stored URL.
 * Stored URLs look like:
 *   https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
 *   https://<R2_PUBLIC_URL>/<bucket>/<key>
 * Returns null when the URL is not one of ours (e.g. a Twilio URL) so callers
 * can leave it untouched.
 */
export function r2KeyFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const isOurR2 =
      u.hostname.endsWith(".r2.cloudflarestorage.com") ||
      (!!envConfig.R2_PUBLIC_URL && u.hostname === envConfig.R2_PUBLIC_URL);
    if (!isOurR2) return null;

    let path = u.pathname.replace(/^\/+/, ""); // strip leading slash(es)
    const prefix = `${BUCKET}/`;
    if (path.startsWith(prefix)) path = path.slice(prefix.length);
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

/**
 * Convert a stored (private) R2 URL into a browser-playable presigned GET URL.
 * Non-R2 URLs (or failures) are returned unchanged so nothing breaks.
 * @param expiresIn seconds the link stays valid (default 12h)
 */
export async function presignR2Url(
  url?: string | null,
  expiresIn = 12 * 60 * 60,
): Promise<string | null> {
  const key = r2KeyFromUrl(url);
  if (!key) return url ?? null;
  try {
    return await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn },
    );
  } catch {
    return url ?? null;
  }
}
