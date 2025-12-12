
// import chatRouter from "./chat";
import { Router } from "express";
import scriptRoutes from "./library/scripts/index"
import smsRoutes from "./library/sms/index"
import callerIdRoutes from "./systemSettings/callerId/index"
import callSettingsRoutes from "./systemSettings/callSettings/index"

const router = Router()

// add routes here
router.use("/library/script",scriptRoutes)
router.use("/library/sms",smsRoutes)
router.use("/system-settings/caller-id", callerIdRoutes)
router.use("/system-settings/call-settings", callSettingsRoutes)


export default router