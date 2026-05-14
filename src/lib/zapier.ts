import { envConfig } from "./config";

export async function triggerZapierWebhook(payload: object) {
    const url = envConfig.ZAPIER_WEBHOOK_URL;
    if (!url) {
        console.warn("[Zapier] No webhook URL configured. Skipping.");
        return;
    }
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        console.log("[Zapier] Webhook fired successfully:", response.status);
    } catch (error) {
        console.error("[Zapier] Webhook failed:", error);
    }
}
