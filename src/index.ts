import express, { Request, Response } from "express";
import morgan from "morgan";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import routes from "./routes/routes";
import { swaggerDocs } from "./utils/handler";
import { cloudinaryConfig, envConfig, sessionMiddleware } from "./lib/config";
import { connectDB } from "./lib/prisma";
import sgMail from "@sendgrid/mail";

connectDB();

const app = express();
const PORT = envConfig.PORT || 3000;

/* ================= MIDDLEWARE ================= */

app.use(sessionMiddleware);

app.use(
  cors({
    origin: "http://localhost:5000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "cf-connecting-ip",
      "x-api-key",
    ],
  })
);

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

sgMail.setApiKey(envConfig.SENDGRID_API_KEY as string);

/* ================= AUTH ================= */

app.all("/api/auth/*", toNodeHandler(auth));

/* ================= BASIC ================= */

cloudinaryConfig();

app.get("/", (_req: Request, res: Response) => {
  res.send("Server chal raha hai bhai!");
});

app.use("/api", routes);

/* =====================================================
   ============ TWILIO / CALLING (COMMENTED) ============
   NOTE: TS clean hai, jab use karna ho uncomment kar lena
===================================================== */

/*

interface Contact {
  name?: string;
  phone: string;
}

interface StartCallingBody {
  contacts: Contact[];
}

let currentQueue: Array<Contact & { status: string }> = [];
let isCallingInProgress = false;

app.post(
  "/start-calling",
  async (
    req: Request<{}, {}, StartCallingBody>,
    res: Response
  ): Promise<Response> => {
    const { contacts } = req.body;

    if (!contacts || contacts.length === 0) {
      return res.status(400).json({
        error: "Kindly send contact array!",
      });
    }

    currentQueue = contacts.map((c, index) => ({
      name: c.name ?? "Unknown",
      phone: c.phone,
      status: index === 0 ? "calling" : "waiting",
    }));

    isCallingInProgress = true;

    return res.json({
      success: true,
      message: "Sequential calling shuru ho gayi!",
      totalContacts: contacts.length,
    });
  }
);

app.get(
  "/calling-status",
  (_req: Request, res: Response): Response => {
    return res.json({
      isActive: isCallingInProgress,
      total: currentQueue.length,
      queue: currentQueue,
    });
  }
);

*/

/* ================= SWAGGER ================= */

swaggerDocs(app);

/* ================= SERVER ================= */

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
