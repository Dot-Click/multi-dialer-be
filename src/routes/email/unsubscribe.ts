import { Request, Response } from "express";
import { addSuppression, verifyUnsubscribe } from "../../utils/emailSuppression";

function page(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background:#f4f7fa; margin:0; padding:0; }
    .card { max-width:480px; margin:80px auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:40px; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,.06); }
    h1 { color:#1f2937; font-size:22px; margin:0 0 12px; }
    p { color:#4b5563; font-size:15px; line-height:1.6; margin:0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

/**
 * GET /api/email/unsubscribe?email=...&sig=...
 * Verifies the HMAC signature, then adds the address to the suppression list.
 * Returns a simple confirmation page.
 */
export const handleUnsubscribe = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.query.email || "");
  const sig = String(req.query.sig || "");

  if (!verifyUnsubscribe(email, sig)) {
    res
      .status(400)
      .send(page("Invalid link", "This unsubscribe link is invalid or has expired."));
    return;
  }

  try {
    await addSuppression(email, "UNSUBSCRIBE", "User unsubscribed via email link");
    res
      .status(200)
      .send(
        page(
          "You're unsubscribed",
          `<strong>${email}</strong> will no longer receive marketing emails from us.`
        )
      );
  } catch (err: any) {
    console.error("[Unsubscribe] Error:", err?.message || err);
    res
      .status(500)
      .send(page("Something went wrong", "Please try again later."));
  }
};
