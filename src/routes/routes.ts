
// import chatRouter from "./chat";
import { Router } from "express";
import scriptRoutes from "./library/scripts"
import smsRoutes from "./library/sms"
import emailRoutes from "./library/email"
import signatureRoutes from "./library/signatures"
import mediaCenterRoutes from "./library/mediaCenter"
import recordingsRoutes from "./library/recordings"
import callerIdRoutes from "./systemSettings/callerId"
import callSettingsRoutes from "./systemSettings/callSettings"
import planLimitsRoutes from "./planLimits"
import callbackPromptRoutes from "./library/callBackPrompt";
import miscFieldsRoutes from "./systemSettings/miscFields"
import appearanceRoutes from "./systemSettings/appearance"
import dialerSettingRoute from "./systemSettings/dialersettings"
import notificationRoute from "./systemSettings/notification"
import IntegrationRoute from "./systemSettings/integration"
import calendarRoutes from "./calender"
import callbacksRoutes from "./callbacks"
import appointmentsRoutes from "./appointments"
import tasksRoutes from "./tasks"
import actionplansRoutes from "./systemSettings/actionplan"
import leadSheetRoutes from "./systemSettings/leadSheet"
import regulatoryRoutes from "./systemSettings/regulatory"
import auditLogRoutes from "./systemSettings/audit"
import dispositionRoutes from "./systemSettings/dispositions"
import callingRoutes from "./calling"
import contactRoutes from "./contact"
import contactListRoutes from "./contactlist"
import userRoutes from "./user"
import companyRoutes from "./company"
import reportRoutes from "./reports"
import SuperAdminReportsRoutes from "./super-admin-reports"
import billingRouter from "./billing"
import pushRoutes from "./push"
import notificationRoutes from "./notification"
import emailHistoryRoutes from "./email-history"
import { handleMyPlusLeadsWebhook } from "./webhooks/myplusleads";
import a2pRoutes from "./a2p";
import { getMyPlusLeadsConfig, updateMyPlusLeadsConfig, deleteMyPlusLeadsConfig, syncMyPlusLeads, repairMyPlusLeads } from "./integrations/myplusleads.controller";
import { checkRole, protectRoute } from "../middlewares/auth.middleware"
import superAdminCallerIdRoutes from "./super-admin/caller-ids"
import { checkFeatureLocked } from "../middlewares/featureLock.middleware";
import { envConfig } from "@/lib/config";
import paymentRoutes from "./payment";
import calendarSyncRoutes from "./calendarSync";

const router = Router()



router.use("/calendar", protectRoute, calendarRoutes)
router.use("/callbacks", protectRoute, callbacksRoutes)
router.use("/appointments", protectRoute, appointmentsRoutes)
router.use("/tasks", protectRoute, tasksRoutes)
router.use("/library/script", protectRoute, scriptRoutes)
router.use("/library/sms", protectRoute, checkFeatureLocked, smsRoutes)
router.use("/library/email", protectRoute, emailRoutes)
router.use("/library/signatures", protectRoute, signatureRoutes)
router.use("/library/media-center", protectRoute, mediaCenterRoutes)
router.use("/library/callback-prompt", protectRoute, callbackPromptRoutes);
router.use("/library/recordings", protectRoute, recordingsRoutes);




router.use("/system-settings/caller-id", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), callerIdRoutes)
router.use("/system-settings/dialer-settings", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), dialerSettingRoute);
router.use("/system-settings/call-settings", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), callSettingsRoutes)
router.use("/system-settings/misc-fields", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), miscFieldsRoutes)
router.use("/system-settings/appearance", protectRoute, checkRole(["ADMIN", "OWNER"]), appearanceRoutes)
router.use("/system-settings/notification", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), notificationRoute)
router.use("/system-settings/action-plans", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), actionplansRoutes)
router.use("/system-settings/lead-sheet", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), leadSheetRoutes)
router.use("/system-settings/integrations", protectRoute, checkRole(["ADMIN", "OWNER"]), IntegrationRoute)
router.use("/system-settings/integration", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), IntegrationRoute)
router.use("/system-settings/regulatory", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), regulatoryRoutes)
router.use("/system-settings/audit-logs", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), auditLogRoutes)
router.use("/system-settings/dispositions", protectRoute, checkRole(["ADMIN", "OWNER", "AGENT"]), dispositionRoutes)

// Contacts & Lists
router.use("/contact", protectRoute, contactRoutes)
router.use("/contact-list", protectRoute, contactListRoutes)
router.use("/user", protectRoute, userRoutes)
router.use("/company", protectRoute, checkRole(["OWNER"]), companyRoutes)
router.use("/reports", protectRoute, reportRoutes)


router.use("/calling", callingRoutes)
router.use("/report", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), SuperAdminReportsRoutes)
router.use("/super-admin/caller-ids", protectRoute, checkRole(["OWNER", "SUPER_ADMIN"]), superAdminCallerIdRoutes)

router.use("/billing", billingRouter)
router.use("/plan-limits", planLimitsRoutes)
router.use("/push", protectRoute, pushRoutes)
router.use("/notification", protectRoute, notificationRoutes)
router.use("/email-history", protectRoute, emailHistoryRoutes)
router.use("/payment", paymentRoutes)
router.use("/calendar-sync", calendarSyncRoutes)
router.use("/a2p", a2pRoutes)

// Integrations & Webhooks
router.post("/webhooks/myplusleads/:userId", handleMyPlusLeadsWebhook);
router.get("/integrations/myplusleads", protectRoute, getMyPlusLeadsConfig);
router.post("/integrations/myplusleads/sync", protectRoute, syncMyPlusLeads);
router.post("/integrations/myplusleads/repair", protectRoute, repairMyPlusLeads);
router.post("/integrations/myplusleads", protectRoute, updateMyPlusLeadsConfig);
router.delete("/integrations/myplusleads", protectRoute, deleteMyPlusLeadsConfig);

router.get("/verified", (req, res) => {
  res.send(`<h1 style="text-align: center; flex: 1; justify-content: center; align-items: center; height: 100vh;">Email verified successfully <a href="${envConfig.FRONTEND_URL}/admin/login">Go to app</a></h1>`)
})

export default router
