
// import chatRouter from "./chat";
import { Router } from "express";
import scriptRoutes from "./library/scripts"
import smsRoutes from "./library/sms"
import emailRoutes from "./library/email"
import signatureRoutes from "./library/signatures"
import mediaCenterRoutes from "./library/mediaCenter"
import recordingsRoutes from "./library/recordings";
import callerIdRoutes from "./systemSettings/callerId"
import callSettingsRoutes from "./systemSettings/callSettings"
import callbackPromptRoutes from "./library/callBackPrompt";
import miscFieldsRoutes from "./systemSettings/miscFields"
import appearanceRoutes from "./systemSettings/appearance"
import dialerSettingRoute from "./systemSettings/dialersettings"
import notificationRoute from "./systemSettings/notification"
import IntegrationRoute from "./systemSettings/integration"
import calendarRoutes from "./calender"
import actionplansRoutes from "./systemSettings/actionplan"
import leadSheetRoutes from "./systemSettings/leadSheet"
import regulatoryRoutes from "./systemSettings/regulatory"
import auditLogRoutes from "./systemSettings/audit"
import callingRoutes from "./calling"
import contactRoutes from "./contact"
import contactListRoutes from "./contactlist"
import userRoutes from "./user"
import companyRoutes from "./company"
import reportRoutes from "./reports"
import subscriptionRoutes from "./subscription"
import { checkRole, protectRoute } from "../middlewares/auth.middleware"
import { envConfig } from "@/lib/config";

const router = Router()



router.use("/calendar", protectRoute, calendarRoutes)
router.use("/library/script", protectRoute, scriptRoutes)
router.use("/library/sms", protectRoute, smsRoutes)
router.use("/library/email", protectRoute, emailRoutes)
router.use("/library/signatures", protectRoute, signatureRoutes)
router.use("/library/media-center", protectRoute, mediaCenterRoutes)
router.use("/library/recordings", protectRoute, recordingsRoutes)
router.use("/library/callback-prompt", protectRoute, callbackPromptRoutes);




router.use("/system-settings/caller-id", protectRoute, checkRole(["ADMIN", "OWNER"]), callerIdRoutes)
router.use("/system-settings/dialer-settings", protectRoute, checkRole(["ADMIN", "OWNER"]), dialerSettingRoute);
router.use("/system-settings/call-settings", protectRoute, checkRole(["ADMIN", "OWNER"]), callSettingsRoutes)
router.use("/system-settings/misc-fields", protectRoute, checkRole(["ADMIN", "OWNER"]), miscFieldsRoutes)
router.use("/system-settings/appearance", protectRoute, checkRole(["ADMIN", "OWNER"]), appearanceRoutes)
router.use("/system-settings/notification-settings", protectRoute, checkRole(["ADMIN", "OWNER"]), notificationRoute)
router.use("/system-settings/action-plans", protectRoute, checkRole(["ADMIN", "OWNER"]), actionplansRoutes)
router.use("/system-settings/lead-sheet", protectRoute, checkRole(["ADMIN", "OWNER"]), leadSheetRoutes)
router.use("/system-settings/integrations", protectRoute, checkRole(["ADMIN", "OWNER"]), IntegrationRoute)
router.use("/system-settings/regulatory", protectRoute, checkRole(["ADMIN", "OWNER"]), regulatoryRoutes)
router.use("/system-settings/audit-logs", protectRoute, checkRole(["ADMIN", "OWNER"]), auditLogRoutes)

// Contacts & Lists
router.use("/contact", protectRoute, contactRoutes)
router.use("/contact-list", protectRoute, contactListRoutes)
router.use("/user", protectRoute, userRoutes)
router.use("/company", protectRoute, checkRole(["OWNER"]), companyRoutes)
router.use("/reports", protectRoute, reportRoutes)


router.use("/calling", callingRoutes)

router.use("/subscriptions", subscriptionRoutes)

router.get("/verified", (req, res) => {
  res.send(`<h1 style="text-align: center; flex: 1; justify-content: center; align-items: center; height: 100vh;">Email verified successfully <a href="${envConfig.FRONTEND_URL}/admin/login">Go to app</a></h1>`)
})

export default router
