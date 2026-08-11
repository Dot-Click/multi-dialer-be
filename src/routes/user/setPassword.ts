import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../../lib/prisma";
import { envConfig } from "../../lib/config";
import { isSetPasswordSignatureValid } from "../../utils/setPasswordLink";

// Self-contained set-password flow: same server-rendered pattern as the
// existing unsubscribe/verify-email pages. Backend has no dedicated frontend
// route for this, and adding one would mean coordinating a FE deploy for
// every backend change; a server-rendered form keeps the whole flow in one
// place and works even if the FE is down.

function page(body: string, title = "Set your Slingvo password"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background:#f4f7fa; margin:0; padding:0; }
    .card { max-width:440px; margin:60px auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:36px; box-shadow:0 10px 25px rgba(0,0,0,.06); }
    h1 { color:#1f2937; font-size:22px; margin:0 0 8px; text-align:center; }
    p { color:#4b5563; font-size:14px; line-height:1.6; margin:0 0 20px; text-align:center; }
    label { color:#374151; font-size:13px; font-weight:600; display:block; margin:16px 0 6px; }
    input { width:100%; box-sizing:border-box; padding:10px 12px; font-size:15px; border:1px solid #d1d5db; border-radius:8px; outline:none; }
    input:focus { border-color:#FFCA06; }
    button { width:100%; padding:12px; margin-top:20px; background:#FFCA06; color:#1a1a1a; font-weight:700; font-size:15px; border:0; border-radius:8px; cursor:pointer; }
    .err { color:#b91c1c; font-size:13px; margin-top:12px; text-align:center; }
    .rules { color:#6b7280; font-size:12px; margin-top:6px; }
  </style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
}

function formPage(email: string, sig: string, error?: string): string {
  return page(`
    <h1>Set your password</h1>
    <p>Setting a password for <strong>${email}</strong>.</p>
    <form method="POST" action="/api/user/set-password">
      <input type="hidden" name="email" value="${email}" />
      <input type="hidden" name="sig" value="${sig}" />
      <label for="pw">New password</label>
      <input id="pw" name="password" type="password" required minlength="8" autocomplete="new-password" />
      <p class="rules">Minimum 8 characters.</p>
      <label for="pw2">Confirm password</label>
      <input id="pw2" name="confirm" type="password" required minlength="8" autocomplete="new-password" />
      ${error ? `<p class="err">${error}</p>` : ""}
      <button type="submit">Set password &amp; sign in</button>
    </form>
  `);
}

// ── GET: render the form ─────────────────────────────────────────────────────
export const showSetPasswordForm = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const sig = String(req.query.sig || "");

  const user = await prisma.user.findUnique({ where: { email }, select: { password: true } });
  if (!user || !isSetPasswordSignatureValid(email, user.password, sig)) {
    res.status(400).send(page(`
      <h1>Invalid link</h1>
      <p>This set-password link is invalid, expired, or has already been used. Ask your admin to resend the invite.</p>
    `, "Invalid link"));
    return;
  }
  res.status(200).send(formPage(email, sig));
};

// ── POST: process the form ───────────────────────────────────────────────────
export const submitSetPassword = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const sig = String(req.body?.sig || "");
  const password = String(req.body?.password || "");
  const confirm = String(req.body?.confirm || "");

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !isSetPasswordSignatureValid(email, user.password, sig)) {
      res.status(400).send(page(`
        <h1>Invalid link</h1>
        <p>This set-password link is invalid, expired, or has already been used.</p>
      `, "Invalid link"));
      return;
    }

    if (password.length < 8) {
      res.status(400).send(formPage(email, sig, "Password must be at least 8 characters."));
      return;
    }
    if (password !== confirm) {
      res.status(400).send(formPage(email, sig, "Passwords don't match."));
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password: hashed, emailVerified: true } }),
      // Better Auth mirrors the password on the Account row (providerId=
      // "credential"); if we don't update both, the user still can't sign
      // in even after "successfully" setting a new password.
      prisma.account.updateMany({
        where: { userId: user.id, providerId: "credential" },
        data: { password: hashed },
      }),
    ]);

    const loginUrl = `${(envConfig.FRONTEND_URL || "").replace(/\/$/, "")}/admin/login?password_set=true`;
    res.redirect(loginUrl);
  } catch (err: any) {
    console.error("[SetPassword] Error:", err?.message || err);
    res.status(500).send(page(`
      <h1>Something went wrong</h1>
      <p>Please try again in a moment, or contact support@slingvo.com.</p>
    `, "Error"));
  }
};
