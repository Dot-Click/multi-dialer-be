import { Router } from "express";
import {
  startCalling,
  handleCallStatus,
  getAvailableUsNumbers,
  buyNumber,
  addLeadsToDialer,
  getDialerStatus,
  getDailyCallStats,
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
  getContactAnalysis,
  filterDialContacts,
  upsertDialSession,
  getDialSession,
  setCounter,
  getCallerIds,
  toggleHold,
  resumeCall,
  dropVoicemail,
  handleAmdStatus,
  stopDialing,
  removeContactFromPowerQueue,
  agentReady,
  handleIncomingSms,
  getSmsInbox,
  getSmsConversation,
  getDialerDebug
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
import { checkFeatureLocked } from "@/middlewares/featureLock.middleware";

const router = Router();

// Calling Control
router.post("/test-call/:agentId", protectRoute, checkFeatureLocked, startCalling);
router.post("/end-call", protectRoute, endCall);
router.post("/toggle-hold", protectRoute, toggleHold);
router.post("/toggle-hold", protectRoute, toggleHold);
router.post("/leads", protectRoute, checkFeatureLocked, addLeadsToDialer);
router.post("/stop-dialing", protectRoute, stopDialing);
router.post("/queue/remove-contact", protectRoute, removeContactFromPowerQueue);
router.post("/agent-ready", protectRoute, agentReady);
router.get("/status", protectRoute, getDialerStatus);
router.get("/daily-stats", protectRoute, getDailyCallStats);
router.get("/debug", protectRoute, getDialerDebug);
router.get("/debug/:userId", protectRoute, getDialerDebug);
router.get("/status/:sid", protectRoute, getCallStatus);
router.get("/getHistory", protectRoute, getHistory);
router.get("/sentiments/:sid", protectRoute, getCallSummary);
router.get("/contact-analysis/:contactId", protectRoute, getContactAnalysis);
router.post("/filter-contacts", protectRoute, filterDialContacts);
router.post("/dial-session", protectRoute, upsertDialSession);
router.get("/dial-session/:listId", protectRoute, getDialSession);

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

// Twilio Webhooks
router.post("/webhooks/voice", handleVoiceWebhook);
router.post("/webhooks/call-status", handleCallStatus);
router.post("/webhooks/recording-status", handleRecordingStatus);
router.post("/webhooks/transcription", handleTranscriptionWebhook);
router.get('/webhooks/resume-call', resumeCall);

router.get("/transcription-logs", protectRoute, getTranscriptionLogs);
router.get("/token", protectRoute, getTwilioToken);

// SMS Inbox & Webhooks
router.post("/send-sms", protectRoute, checkFeatureLocked, sendSms);
router.post("/webhooks/sms-status", (req, res) => {
  console.log(`[SMS Webhook] Status: ${req.body.SmsStatus}, SID: ${req.body.SmsSid}`);
  res.sendStatus(200);
});
router.post("/webhooks/incoming-sms", handleIncomingSms);
router.get("/sms/inbox", protectRoute, getSmsInbox);
router.get("/sms/conversation/:contactId", protectRoute, getSmsConversation);

// Number Management
router.post("/available-numbers", protectRoute, getAvailableUsNumbers);
router.post("/buy-number", protectRoute, checkFeatureLocked, buyNumber);

// call managements
router.patch('/set-counter/:sid', protectRoute, setCounter)
router.get('/callerIds', protectRoute, getCallerIds)

//calls insights
router.get("/calls-insights", protectRoute, getCallsInsights);

// Answering Machine
router.post("/webhooks/amd-status", handleAmdStatus);
router.post("/drop-voicemail", protectRoute, dropVoicemail);

export default router;
