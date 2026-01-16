// import express, { Request, Response, NextFunction } from "express";
// import { PrismaClient } from "@prisma/client";
// import { toNodeHandler } from "better-auth/node";
// import { auth } from "./lib/auth";
// import morgan from "morgan"; 
// import cors from "cors";
// import { connectDB } from "./lib/prisma";
// import prisma from "./lib/prisma";
// import routes from "./routes/routes";
// import { swaggerDocs } from "./utils/handler";
// import { cloudinaryConfig, envConfig, sessionMiddleware } from "./lib/config";
// import sgMail from "@sendgrid/mail";
// import twilio from 'twilio';



// connectDB();
// const app = express();
// const PORT = envConfig.PORT || 3000;

// app.use(sessionMiddleware);
// app.use(
//   cors({
//     origin: "http://localhost:5000",
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
//     allowedHeaders: ["Content-Type", "Authorization",'cf-connecting-ip','x-api-key'],
//   })
// );
// app.use(morgan('dev'));
// sgMail.setApiKey(envConfig.SENDGRID_API_KEY as string)

// // TWILIO CONFIGURATION 
// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;

// const client = twilio(accountSid, authToken);

// // Parse JSON body BEFORE auth routes
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Middleware to auto-verify ONLY test2@example.com before sign-in
// app.use("/api/auth/sign-in/email", async (req: Request, res: Response, next: NextFunction) => {
//   if (req.method === "POST" && req.body?.email) {
//     try {
//       const email = req.body.email.toLowerCase().trim();
      
//       if (email === "test2@example.com") {
//         // Auto-verify ONLY test2@example.com
//         await prisma.user.updateMany({
//           where: {
//             email: "test2@example.com",
//           },
//           data: {
//             emailVerified: true,
//           },
//         });
//       }
//     } catch (err: any) {
//       console.error("❌ Error in sign-in middleware:", err?.message);
//     }
//   }
//   next();
// });

// app.all("/api/auth/*", toNodeHandler(auth));

// cloudinaryConfig();

// app.get("/", (req: Request, res: Response) => {
//   res.send("Ciao, TypeScript con Express!");
// });
// app.use("/api", routes);
// // server.js mein (upar wale code ke saath)

// // Temporary test route sirf development/testing ke liye
// app.post('/test-call', async (req, res) => {
//   try {
//     const call = await client.calls.create({
//       url: "http://demo.twilio.com/docs/voice.xml",  // Twilio ka default voice XML (ek robot lady bolegi "Hello, this is a test call from Twilio")
//       to: "+923179651693",   // Tera number jahan call aana chahiye
//       // from: "+19804093273",  // Tera Twilio number
//       from: process.env.TWILIO_PHONE_NUMBER,  // Tera Twilio number
//       timeout: 30,
//       statusCallback: 'https://your-ngrok-url.ngrok.io/webhook/status', // Optional – agar status track karna hai
//       statusCallbackMethod: 'POST'
//     });

//     console.log("Call SID:", call.sid);
//     res.json({
//       success: true,
//       message: "Call initiated!",
//       sid: call.sid
//     });
//   } catch (error) {
//     console.error("Call failed:", error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// swaggerDocs(app);

// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });



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
import twilio from 'twilio';

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

// TWILIO CONFIGURATION 
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;  // .env mein daal lena

// Only initialize Twilio client if credentials are valid
let client: ReturnType<typeof twilio> | null = null;

if (!accountSid || !authToken || !fromNumber) {
  console.warn("⚠️ Twilio credentials missing or incomplete in .env! Twilio features will be disabled.");
} else if (!accountSid.startsWith('AC')) {
  console.warn("⚠️ Invalid Twilio accountSid (must start with 'AC'). Twilio features will be disabled.");
} else {
  try {
    client = twilio(accountSid, authToken);
    console.log("✓ Twilio client initialized successfully");
  } catch (error: any) {
    console.warn("⚠️ Failed to initialize Twilio client:", error.message);
    client = null;
  }
  
}

// Parse JSON body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware for auto-verify (tera wahi)
app.use("/api/auth/sign-in/email", async (req: Request, res: Response, next: NextFunction) => {
  if (req.method === "POST" && req.body?.email) {
    try {
      const email = req.body.email.toLowerCase().trim();
      if (email === "test2@example.com") {
        await prisma.user.updateMany({
          where: { email: "test2@example.com" },
          data: { emailVerified: true },
        });
      }
    } catch (err: any) {
      console.error("Error in sign-in middleware:", err?.message);
    }
  }
  next();
});

app.all("/api/auth/*", toNodeHandler(auth));

cloudinaryConfig();

app.get("/", (req: Request, res: Response) => {
  res.send("Server chal raha hai bhai!");
});
app.use("/api", routes);

// ============ TWILIO CALLING FEATURES START ============

// 1. Single test call (jo pehle chal rahi thi)
// app.post('/test-call', async (req, res) => {
//   try {
//     const call = await client.calls.create({
//       url: "http://demo.twilio.com/docs/voice.xml",  // Robot voice test message
//       to: "+923179651693",  // Tera number
//       from: fromNumber,
//       timeout: 30,
//     });

//     console.log("Single Test Call SID:", call.sid);
//     res.json({
//       success: true,
//       message: "Single test call lagi!",
//       sid: call.sid
//     });
//   } catch (error: any) {
//     console.error("Single call failed:", error.message);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// ============ SIMPLE SEQUENTIAL CALLING (NO DB, NO SOCKET) ============

let currentQueue: Array<{ name?: string; phone: string; status: string }> = [];
let isCallingInProgress = false;

// API 1: Yeh hit kar pehle – multiple contacts pe sequential calling start karegi
app.post('/start-calling', async (req: Request, res: Response): Promise<void> => {
  const { contacts } = req.body;  // Array of { name, phone }

  if (!contacts || contacts.length === 0) {
    res.status(400).json({ error: "Kindly send contact array!" });
    return;
  }

  // Queue banao
  currentQueue = contacts.map((c: any, index: number) => ({
    name: c.name || "Unknown",
    phone: c.phone,
    status: index === 0 ? 'calling' : 'waiting'
  }));

  isCallingInProgress = true;

  res.json({
    success: true,
    message: "Sequential calling shuru ho gayi!",
    totalContacts: contacts.length
  });

  // Pehli call turant laga do
  makeNextCall();
});

// API 2: Yeh hit kar status check karne ke liye (kitni calls hui, kitni baki)
app.get('/calling-status', (req, res) => {
  res.json({
    isActive: isCallingInProgress,
    total: currentQueue.length,
    queue: currentQueue
  });
});

// Main function – ek ke baad ek call lagati hai
async function makeNextCall() {
  if (!isCallingInProgress) return;

  const current = currentQueue.find(c => c.status === 'calling');
  if (!current) {
    isCallingInProgress = false;
    console.log("Sab calls khatam ho gayi! 🎉");
    return;
  }

  console.log(`Calling: ${current.name} (${current.phone})`);

  try {
    // Check if Twilio client is available
    if (!client) {
      console.error("Twilio client not initialized. Please configure Twilio credentials in .env");
      current.status = 'failed';
      makeNextCall();
      return;
    }

    if (!fromNumber) {
      console.error("Twilio phone number not configured");
      current.status = 'failed';
      makeNextCall();
      return;
    }

    console.log(`Calling customer: ${current.name || 'Unknown'} (${current.phone})`);
  
    // Ye Twilio ka free tool use karega jo direct forward karega
    const forwardUrl = `http://twimlets.com/forward?PhoneNumber=${encodeURIComponent(process.env.AGENT_PHONE_NUMBER || '+923179651693')}&Message=${encodeURIComponent('Please wait, agent se connect kar rahe hain...')}&Timeout=30`;
  
    const twilioFromNumber: string = fromNumber;
    const call = await client.calls.create({
      to: current.phone,       // Customer ka number
      from: twilioFromNumber,        // Twilio ka number
      url: forwardUrl,         // Ye magic link hai jo agent ko connect karega
      timeout: 35,
      machineDetection: 'Enable'
    });
  
    console.log("Call SID:", call.sid);
    current.status = 'ringing';
  
    // Ye timeout wala part same rahega (40 sec baad next call jayegi)
    setTimeout(() => {
      current.status = 'completed';
  
      const currentIndex = currentQueue.indexOf(current);
      if (currentIndex + 1 < currentQueue.length) {
        currentQueue[currentIndex + 1].status = 'calling';
        makeNextCall();
      } else {
        isCallingInProgress = false;
        console.log("Sab calls khatam!");
      }
    }, 40000);
  
  } catch (error: any) {
    console.error("Call fail:", error.message);
    current.status = 'failed';
  
    // Fail hone pe bhi next call
    const currentIndex = currentQueue.indexOf(current);
    if (currentIndex + 1 < currentQueue.length) {
      currentQueue[currentIndex + 1].status = 'calling';
      makeNextCall();
    } else {
      isCallingInProgress = false;
    }
  }
}

// ============ SEQUENTIAL END ============

swaggerDocs(app);

app.listen(PORT, () => {
  console.log(`Server chal raha hai: http://localhost:${PORT}`);
});