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
  getHistory,
  getCallStatus,
  getCallSummary,
  setCounter,
  getCallerIds,
  toggleHold,
  resumeCall,
  dropVoicemail,
  handleAmdStatus,
  stopDialing
} from "./controller";
import {
  getAggregateStats,
  getCallDetails,
  getSessions,
  startSession,
  // endSession,
  // getSidekickInsights,
  // getBestTimeToCall,
  // getLeadIntelligence,
  // getAiCoaching,
  // getCallOutcome,
  // getEfficiency,
  // getCompliance,
  // getCallGroup,
  // getImprovement
  endSession,
  getSidekickInsights,
  getBestTimeToCall,
  getLeadIntelligence,
  getAiCoaching,
  getCallOutcome,
  getEfficiency,
  getCompliance,
  getCallGroup,
  getImprovement
} from "./analytics.controller";
import { protectRoute, checkRole } from "@/middlewares/auth.middleware";

const router = Router();

// Calling Control
router.post("/test-call/:agentId", protectRoute, startCalling);
router.post("/end-call", protectRoute, endCall);
router.post("/toggle-hold", protectRoute, toggleHold);
router.post("/toggle-hold", protectRoute, toggleHold);
router.post("/leads", protectRoute, addLeadsToDialer);
router.post("/stop-dialing", protectRoute, stopDialing);
router.get("/status/:sid", protectRoute, getCallStatus);
router.get("/getHistory", protectRoute, getHistory);
router.get("/sentiments/:sid", protectRoute, getCallSummary);

// Analytics & Reports
router.get("/stats", protectRoute, getAggregateStats);
router.get("/report/calls", protectRoute, getCallDetails);
router.get("/report/sessions", protectRoute, getSessions);
router.post("/session/start", protectRoute, startSession);
router.post("/session/:sessionId/end", protectRoute, endSession);
router.get("/sidekick-insights", protectRoute, getSidekickInsights);
router.get("/best-time-to-call", protectRoute, getBestTimeToCall);
router.get("/lead-intelligence", protectRoute, getLeadIntelligence);
router.get("/ai-coaching", protectRoute, getAiCoaching);
router.get("/call-outcome", protectRoute, getCallOutcome);
router.get("/efficiency", protectRoute, getEfficiency);
router.get("/compliance", protectRoute, getCompliance);
router.get("/call-group", protectRoute, getCallGroup);
router.get("/improvement", protectRoute, getImprovement);
router.get("/sidekick-insights", protectRoute, getSidekickInsights);
router.get("/best-time-to-call", protectRoute, getBestTimeToCall);
router.get("/lead-intelligence", protectRoute, getLeadIntelligence);
router.get("/ai-coaching", protectRoute, getAiCoaching);
router.get("/call-outcome", protectRoute, getCallOutcome);
router.get("/efficiency", protectRoute, getEfficiency);
router.get("/compliance", protectRoute, getCompliance);
router.get("/call-group", protectRoute, getCallGroup);
router.get("/improvement", protectRoute, getImprovement);

// Twilio Webhooks
router.post("/webhooks/voice", handleVoiceWebhook);
router.post("/webhooks/call-status", handleCallStatus);
router.post("/webhooks/voice", handleVoiceWebhook);
router.post("/webhooks/call-status", handleCallStatus);
router.post("/webhooks/recording-status", handleRecordingStatus);
router.post("/webhooks/transcription", handleTranscriptionWebhook);
router.get('/webhooks/resume-call', resumeCall);

router.get("/transcription-logs", getTranscriptionLogs);
router.get("/token", protectRoute, getTwilioToken);
router.get("/token", protectRoute, getTwilioToken);

// messagings
router.post("/send-sms", protectRoute, sendSms);

// Number Management
router.post("/available-numbers", protectRoute, getAvailableUsNumbers);
router.post("/buy-number", protectRoute, buyNumber);

// call managements}
router.patch('/set-counter/:sid', protectRoute, setCounter)
router.get('/callerIds', protectRoute, getCallerIds)

// call managements}
router.patch('/set-counter/:sid', protectRoute, setCounter)
router.get('/callerIds', protectRoute, getCallerIds)

//calls insights
router.get("/calls-insights", protectRoute, getCallsInsights);

// call managements}
router.patch('/set-counter/:sid', protectRoute, setCounter)
router.get('/callerIds', protectRoute, getCallerIds)


// Answering Machine
router.post("/webhooks/amd-status", handleAmdStatus);  
router.post("/drop-voicemail", protectRoute, dropVoicemail);

export default router;
