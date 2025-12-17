
// import chatRouter from "./chat";
import { Router } from "express";
import scriptRoutes from "./library/scripts/index"
import smsRoutes from "./library/sms/index"
import emailRoutes from "./library/email/index"
import mediaCenterRoutes from "./library/mediaCenter/index"
import callerIdRoutes from "./systemSettings/callerId/index"
import callSettingsRoutes from "./systemSettings/callSettings/index"
import callbackPromptRoutes from "./library/callBackPrompt/index";
import miscFieldsRoutes from "./systemSettings/miscFields/index"
import appearanceRoutes from "./systemSettings/appearance/index"
import dialerSettingRoute from "./systemSettings/dialersettings/index"
import  notificationRoute from "./systemSettings/notification/index"
import { checkRole, protectRoute } from "../middlewares/auth.middleware"

const router = Router()



router.use("/library/script", protectRoute, scriptRoutes)
router.use("/library/sms", protectRoute, smsRoutes)
router.use("/library/email", protectRoute, emailRoutes)
router.use("/library/media-center", protectRoute, mediaCenterRoutes)
router.use("/library/callback-prompt",protectRoute,callbackPromptRoutes);




router.use("/system-settings/caller-id", protectRoute, checkRole(["ADMIN", "OWNER"]), callerIdRoutes)
router.use("/system-settings/dialer-settings",protectRoute, checkRole(["ADMIN", "OWNER"]),dialerSettingRoute);
router.use("/system-settings/call-settings", protectRoute, checkRole(["ADMIN", "OWNER"]), callSettingsRoutes)
router.use("/system-settings/misc-fields", protectRoute, checkRole(["ADMIN", "OWNER"]), miscFieldsRoutes)
router.use("/system-settings/appearance", protectRoute, checkRole(["ADMIN", "OWNER"]), appearanceRoutes)
router.use("/system-settings/notification-settings", protectRoute, checkRole(["ADMIN", "OWNER"]), notificationRoute)


export default router