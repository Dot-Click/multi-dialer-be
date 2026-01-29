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
    origin: ["http://localhost:5000", "https://multi-dialer-fe.vercel.app"],
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



/* ================= SWAGGER ================= */

swaggerDocs(app);

/* ================= SERVER ================= */

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});





