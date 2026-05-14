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
