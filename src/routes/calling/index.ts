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
  endCall,
  getCallsInsights,
  getHistory
} from "./controller";
import {
  getAggregateStats,
  getCallDetails,
  getSessions,
  startSession,
  endSession
} from "./analytics.controller";
import { protectRoute, checkRole } from "@/middlewares/auth.middleware";

const router = Router();

// Calling Control
router.post("/test-call/:agentId", protectRoute, startCalling);
router.post("/end-call", protectRoute, endCall);
router.post("/leads", protectRoute, addLeadsToDialer);
router.get("/status", protectRoute, getDialerStatus);
router.get("/getHistory/:id", protectRoute, getHistory);

// Analytics & Reports
router.get("/stats", protectRoute, getAggregateStats);
router.get("/report/calls", protectRoute, getCallDetails);
router.get("/report/sessions", protectRoute, getSessions);
router.post("/session/start", protectRoute, startSession);
router.post("/session/:sessionId/end", protectRoute, endSession);

// Twilio Webhooks
router.post("/webhooks/voice/:agentId", protectRoute, handleVoiceWebhook);
router.post("/webhooks/call-status/:agentId", protectRoute, handleCallStatus);
router.post("/webhooks/recording-status", protectRoute, handleRecordingStatus);
router.post("/webhooks/transcription", protectRoute, handleTranscriptionWebhook);

router.get("/transcription-logs", protectRoute, getTranscriptionLogs);
router.get("/token", protectRoute, getTwilioToken);

// messagings
router.post("/send-sms", protectRoute, sendSms);

// Number Management
router.post("/available-numbers", protectRoute, getAvailableUsNumbers);
router.post("/buy-number", protectRoute, buyNumber);

//calls insights
router.get("/calls-insights", protectRoute, getCallsInsights);
export default router;
