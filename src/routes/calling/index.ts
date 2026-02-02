import { Router } from "express";
import { 
  startCalling, 
  handleCallStatus, 
  getAvailableUsNumbers, 
  buyNumber, 
  addLeadsToDialer, 
  getDialerStatus, 
  handleVoiceWebhook,
  handleRecordingStatus
} from "./controller";
import { protectRoute } from "../../middlewares/auth.middleware";

const router = Router();

// Calling Control
router.post("/test-call",  startCalling);
router.post("/leads",  addLeadsToDialer);
router.get("/status",  getDialerStatus);

// Twilio Webhooks (Usually public but verified by Twilio signature if needed)
router.post("/webhooks/voice", handleVoiceWebhook);
router.post("/webhooks/call-status", handleCallStatus);
router.post("/webhooks/recording-status", handleRecordingStatus);

// Number Management
router.get("/available-numbers",  getAvailableUsNumbers);
router.post("/buy-number",  buyNumber);

export default router;
