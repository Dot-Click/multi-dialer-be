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





/* =====================================================
   ============ TWILIO / CALLING (COMMENTED) ============
   NOTE: TS clean hai, jab use karna ho uncomment kar lena
===================================================== */

/*

interface Contact {
  name?: string;
  phone: string;
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
    console.log(`Calling customer: ${current.name || 'Unknown'} (${current.phone})`);
  
    // Ye Twilio ka free tool use karega jo direct forward karega
    const forwardUrl = `http://twimlets.com/forward?PhoneNumber=${encodeURIComponent(process.env.AGENT_PHONE_NUMBER || '+923179651693')}&Message=${encodeURIComponent('Please wait, agent se connect kar rahe hain...')}&Timeout=30`;
  
    if (!fromNumber) {
      console.error("Twilio phone number not configured");
      current.status = 'failed';
      makeNextCall();
      return;
    }

    const call = await client.calls.create({
      to: current.phone,       // Customer ka number
      from: fromNumber,        // Twilio ka number
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