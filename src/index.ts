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

connectDB();
startRetentionJobs();
initJobs();
startA2PStatusPoller();
startMyPlusLeadsSyncWorker();

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
