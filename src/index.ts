import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import morgan from "morgan"; 
import cors from "cors";
import { connectDB } from "./lib/prisma";
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
app.all("/api/auth/*", toNodeHandler(auth));


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

cloudinaryConfig();

app.get("/", (req: Request, res: Response) => {
  res.send("Ciao, TypeScript con Express!");
});
app.use("/api", routes);

swaggerDocs(app);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
