import crypto from "crypto";
import { envConfig } from "../lib/config";

const ALGORITHM = "aes-256-cbc";
const KEY = crypto.scryptSync(envConfig.EIN_ENCRYPTION_KEY || "fallback-key-32-chars-long-min!!", "salt", 32);
const IV_LENGTH = 16;

/**
 * Encrypts a string (e.g. EIN) using AES-256-CBC.
 */
export function encryptEIN(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a string using AES-256-CBC.
 */
export function decryptEIN(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

// SMTP credentials use a dedicated key (not EIN_ENCRYPTION_KEY) so rotating one
// secret never affects the other. A missing env key means everything already
// saved was encrypted with the fallback — and if the real key is ever added
// later, previously-saved passwords will silently fail to decrypt. Warn once
// at startup so this misconfiguration is visible in the logs.
if (!envConfig.SMTP_ENCRYPTION_KEY) {
    console.warn(
        "[encryption] SMTP_ENCRYPTION_KEY is not set — falling back to the built-in default. " +
        "Any SMTP passwords saved with this fallback will fail to decrypt once the real key is added."
    );
}
const SMTP_KEY = crypto.scryptSync(envConfig.SMTP_ENCRYPTION_KEY || "fallback-key-32-chars-long-min!!", "salt", 32);

/**
 * Thrown by decryptSmtpPassword when the stored ciphertext can't be
 * decrypted with the current SMTP_KEY (missing/rotated SMTP_ENCRYPTION_KEY,
 * or corrupted row). Callers should catch this and prompt the user to
 * re-enter their SMTP password instead of leaking the raw crypto error.
 */
export class SmtpPasswordDecryptError extends Error {
    constructor(cause: unknown) {
        super("Stored SMTP password could not be decrypted — please re-enter it in Settings and save again.");
        this.name = "SmtpPasswordDecryptError";
        (this as any).cause = cause;
    }
}

/**
 * Encrypts a string (e.g. an SMTP password) using AES-256-CBC.
 */
export function encryptSmtpPassword(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, SMTP_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts an SMTP password encrypted with encryptSmtpPassword. Throws
 * SmtpPasswordDecryptError on any crypto failure so callers can present
 * a user-actionable message instead of the raw "bad decrypt" error.
 */
export function decryptSmtpPassword(encryptedText: string): string {
    try {
        const [ivHex, encrypted] = encryptedText.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const decipher = crypto.createDecipheriv(ALGORITHM, SMTP_KEY, iv);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch (err) {
        throw new SmtpPasswordDecryptError(err);
    }
}
