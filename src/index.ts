import express, { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import morgan from "morgan"; 
import cors from "cors";
import { connectDB } from "./lib/prisma";
import prisma from "./lib/prisma";
import routes from "./routes/routes";
import { swaggerDocs } from "./utils/handler";
import { cloudinaryConfig, envConfig, sessionMiddleware } from "./lib/config";
import sgMail from "@sendgrid/mail";

connectDB();
const app = express();
const PORT = envConfig.PORT || 3000;

app.use(sessionMiddleware);
app.use(
  cors({
    origin: "http://localhost:5000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization",'cf-connecting-ip','x-api-key'],
  })
);
app.use(morgan('dev'));
sgMail.setApiKey(envConfig.SENDGRID_API_KEY as string)

// Parse JSON body BEFORE auth routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to auto-verify ONLY test2@example.com before sign-in
app.use("/api/auth/sign-in/email", async (req: Request, res: Response, next: NextFunction) => {
  if (req.method === "POST" && req.body?.email) {
    try {
      const email = req.body.email.toLowerCase().trim();
      
      if (email === "test2@example.com") {
        // Auto-verify ONLY test2@example.com
        await prisma.user.updateMany({
          where: {
            email: "test2@example.com",
          },
          data: {
            emailVerified: true,
          },
        });
      }
    } catch (err: any) {
      console.error("❌ Error in sign-in middleware:", err?.message);
    }
  }
  next();
});

app.all("/api/auth/*", toNodeHandler(auth));

cloudinaryConfig();

app.get("/", (req: Request, res: Response) => {
  res.send("Ciao, TypeScript con Express!");
});
app.use("/api", routes);

swaggerDocs(app);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
