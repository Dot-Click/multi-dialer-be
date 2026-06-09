import express, { Request, Response } from "express";
import morgan from "morgan";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "@/lib/auth";
import routes from "@/routes/routes";
import { swaggerDocs } from "@/utils/handler";
import { connectDB } from "@/lib/prisma";
import { envConfig, sessionMiddleware } from "@/lib/config";
import sgMail from "@sendgrid/mail";
import { startRetentionJobs } from "@/services/retention.service";
import { initJobs } from "@/jobs";
import { handleStripeWebhook } from "@/routes/webhooks/stripe";
import { startA2PStatusPoller } from "@/workers/a2pStatusPoller";
import { startMyPlusLeadsSyncWorker } from "@/workers/myPlusLeadsSync";
import { backfillMyPlusLeadsExistingUsers } from "@/workers/myPlusLeadsBackfill";

connectDB();
if (process.env.ENABLE_CRON === "true") {
  // FIX: keep cron/worker startup on one designated instance to avoid duplicate DB polling.
  startRetentionJobs();
  initJobs();
  startA2PStatusPoller();
  startMyPlusLeadsSyncWorker();

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

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));

sgMail.setApiKey(envConfig.SENDGRID_API_KEY as string);

app.all("/api/auth/*", toNodeHandler(auth));

app.get("/", (_req: Request, res: Response) => {
  res.send("<h1>api</h1>");
});

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
});
