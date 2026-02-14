import { Router } from "express";
import { 
  startCalling, 
  handleCallStatus, 
  getAvailableUsNumbers, 
  buyNumber, 
  addLeadsToDialer, 
  getDialerStatus, 
  sendSms,
  handleVoiceWebhook,
  handleRecordingStatus,
  handleTranscriptionWebhook,
  getTranscriptionLogs,
  getTwilioToken,
  endCall
} from "./controller";
import { protectRoute, checkRole } from "@/middlewares/auth.middleware";

const router = Router();

// Calling Control
router.post("/test-call",  startCalling);
router.post("/end-call",  endCall);
router.post("/leads",  addLeadsToDialer);
router.get("/status",  getDialerStatus);

// Twilio Webhooks
router.post("/webhooks/voice", handleVoiceWebhook);
router.post("/webhooks/call-status", handleCallStatus);
router.post("/webhooks/recording-status", handleRecordingStatus);
router.post("/webhooks/transcription", handleTranscriptionWebhook);

router.get("/transcription-logs", getTranscriptionLogs);
router.get("/token", getTwilioToken);

// messagings
router.post("/send-sms",  sendSms);

// Number Management
router.get("/available-numbers",  getAvailableUsNumbers);
router.post("/buy-number",  buyNumber);

export default router;
