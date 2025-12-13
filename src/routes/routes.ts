
// import chatRouter from "./chat";
import { Router } from "express";
import scriptRoutes from "./library/scripts/index"
import smsRoutes from "./library/sms/index"
import mediaCenterRoutes from "./library/mediaCenter/index"
import callerIdRoutes from "./systemSettings/callerId/index"
import callSettingsRoutes from "./systemSettings/callSettings/index"
import miscFieldsRoutes from "./systemSettings/miscFields/index"

const router = Router()

// add routes here
router.use("/library/script",scriptRoutes)
router.use("/library/sms",smsRoutes)
router.use("/library/media-center", mediaCenterRoutes)
router.use("/system-settings/caller-id", callerIdRoutes)
router.use("/system-settings/call-settings", callSettingsRoutes)
router.use("/system-settings/misc-fields", miscFieldsRoutes)


export default router