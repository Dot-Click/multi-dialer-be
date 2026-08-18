import dns from "dns";
// Railway's containers have no outbound IPv6 route. Hosts that publish both
// A and AAAA records (e.g. smtp.gmail.com) can still resolve to an IPv6
// address by default, which then fails instantly with ENETUNREACH instead of
// falling back to IPv4 — Node only falls back on a *timeout*, not on a
// same-family unreachable error. Forcing IPv4-first here (process-wide, so
// it covers nodemailer's SMTP connections along with everything else) avoids
// ever attempting the unreachable IPv6 address in the first place.
dns.setDefaultResultOrder("ipv4first");

import express, { Request, Response } from "express";
import morgan from "morgan";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "@/lib/auth";
import routes from "@/routes/routes";
import { swaggerDocs } from "@/utils/handler";
import prisma, { connectDB } from "@/lib/prisma";
import { envConfig, sessionMiddleware } from "@/lib/config";
import { startRetentionJobs } from "@/services/retention.service";
import { initJobs } from "@/jobs";
import { handleStripeWebhook } from "@/routes/webhooks/stripe";
import { handleMailerSendWebhook } from "@/routes/webhooks/mailersend";
import { handleUnsubscribe } from "@/routes/email/unsubscribe";
import { handleVerifyEmail } from "@/routes/user/verifyEmail";
import { showSetPasswordForm, submitSetPassword } from "@/routes/user/setPassword";
import { startA2PStatusPoller } from "@/workers/a2pStatusPoller";
import { startMyPlusLeadsSyncWorker } from "@/workers/myPlusLeadsSync";
import { backfillMyPlusLeadsExistingUsers } from "@/workers/myPlusLeadsBackfill";
import { startLeadStoreReminderWorker } from "@/workers/leadStoreReminder";
import { dialerService } from "@/routes/calling/services";

connectDB();
if (process.env.ENABLE_CRON === "true") {
  // FIX: keep cron/worker startup on one designated instance to avoid duplicate DB polling.
  startRetentionJobs();
  initJobs();
  startA2PStatusPoller();
  startMyPlusLeadsSyncWorker();
  startLeadStoreReminderWorker();

  // One-time backfill: pulls leads for existing users who signed up before
  // auto-sync was implemented (lastSyncAt = null). Safe to re-deploy — already
  // synced users are skipped automatically. Run after a short delay so the
  // server is fully ready before hitting the MyPlusLeads API.
  setTimeout(() => {
    backfillMyPlusLeadsExistingUsers().catch((err) =>
      console.error("[MyPlusLeads Backfill] Unexpected error:", err)
    );
  }, 10_000); // 10-second delay after startup
} else {
  console.log("⏭️ Cron jobs disabled - set ENABLE_CRON=true to enable");
}

const app = express();
const PORT = envConfig.PORT || 3001;

app.use(sessionMiddleware);

app.use(
  cors({
    origin: ["http://localhost:5000", "https://slingvo.com", "https://multi-dialer-fe.vercel.app", "https://slingvo-fe-production.up.railway.app", "https://slingvo-landingpage-production.up.railway.app", "https://app.slingvo.com", "https://slingvo-agent-ai-dialer.vercel.app", "http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "cf-connecting-ip",
      "x-api-key",
      "bypass-tunnel-reminder",
    ],
  })
);

app.use(morgan("dev"));

// Stripe webhook must be parsed as raw buffer before express.json()
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

// MailerSend activity webhooks (Sent/Delivered/Opened/Clicked/bounces/complaints/
// unsubscribes) — raw buffer required for HMAC signature verification.
app.post("/api/webhooks/mailersend", express.raw({ type: "application/json" }), handleMailerSendWebhook);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));

// Check email exists before Better Auth handles forget-password (BA always returns 200 even for unknown emails)
app.post("/api/auth/forget-password", async (req: Request, res: Response, next: any) => {
  const { email } = req.body;
  if (email) {
    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    if (!user) {
      res.status(404).json({ message: "No account found with that email address." });
      return;
    }
  }
  next();
});

app.all("/api/auth/*", toNodeHandler(auth));

app.get("/", (_req: Request, res: Response) => {
  res.send("<h1>api</h1>");
});

// Public unsubscribe endpoint (no auth — accessed from email links)
app.get("/api/email/unsubscribe", handleUnsubscribe);

// Public verify-email endpoint (no auth — accessed from the "Verify Email"
// button in agent-invite/admin-welcome emails)
app.get("/api/user/verify-email", handleVerifyEmail);

// Public set-password endpoint (no auth — accessed from the "Set Password"
// button in admin-created account emails; HMAC signature bound to the
// current password hash makes the link single-use automatically)
app.get("/api/user/set-password", showSetPasswordForm);
app.post("/api/user/set-password", submitSetPassword);

app.use("/api", routes);

// Global Error Handler
app.use(async (err: any, req: Request, res: Response, next: any) => {
  console.error("[Global Error Handler]", err);

  // If it's a 500 error, notify admins via Web Push
  if (!err.status || err.status === 500) {
    try {
      const { broadcastNotification } = await import('./routes/push/service.js');
      await broadcastNotification({
        title: "Critical System Error",
        body: `A critical error occurred: ${err.message || 'Unknown error'}. Check server logs for details.`,
        url: "/admin/logs" // Adjust to your actual logs page if any
      });
    } catch (pushErr) {
      console.error("Failed to send critical error push notification:", pushErr);
    }
  }

  const statusCode = err.status || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

swaggerDocs(app);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Start the power-dialer reconciliation watchdog. This MUST run in the same
  // process that serves the Twilio webhooks (that's where the DialerService
  // singleton's in-memory state lives), so it is NOT gated behind ENABLE_CRON.
  dialerService.startReconciliationLoop();
});
