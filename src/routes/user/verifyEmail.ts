import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { envConfig } from "../../lib/config";
import { isVerifyEmailSignatureValid } from "../../utils/verifyEmailLink";

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
 * GET /api/user/verify-email?email=...&sig=...
 * Verifies the HMAC signature (same stateless pattern as the unsubscribe
 * link), marks the account emailVerified, then redirects to login. Used by
 * the "Verify Email" button in agentInviteTemp — admin-created accounts
 * (via Better Auth's /admin/create-user) never go through Better Auth's own
 * verification flow, so this is the only path that sets emailVerified for them.
 */
export const handleVerifyEmail = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.query.email || "");
  const sig = String(req.query.sig || "");

  if (!isVerifyEmailSignatureValid(email, sig)) {
    res
      .status(400)
      .send(page("Invalid link", "This verification link is invalid or has expired."));
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      res.status(404).send(page("Account not found", "We couldn't find an account for this email."));
      return;
    }

    if (!user.emailVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    }

    const loginUrl = `${(envConfig.FRONTEND_URL || "").replace(/\/$/, "")}/admin/login?verified=true`;
    res.redirect(loginUrl);
  } catch (err: any) {
    console.error("[VerifyEmail] Error:", err?.message || err);
    res.status(500).send(page("Something went wrong", "Please try again later."));
  }
};
