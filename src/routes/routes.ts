
// import chatRouter from "./chat";
import { Router } from "express";
import scriptRoutes from "./library/scripts/index"
import smsRoutes from "./library/sms/index"
import mediaCenterRoutes from "./library/mediaCenter/index"
import callerIdRoutes from "./systemSettings/callerId/index"
import callSettingsRoutes from "./systemSettings/callSettings/index"
import miscFieldsRoutes from "./systemSettings/miscFields/index"
import { checkRole, protectRoute } from "../middlewares/auth.middleware"

const router = Router()

// add routes here

// agent + admin + super admin (owner)
router.use("/library/script", protectRoute, scriptRoutes)
router.use("/library/sms", protectRoute, smsRoutes)
router.use("/library/media-center", protectRoute, mediaCenterRoutes)


// admin + super admin (owner)   no agent can acces these routes 
// protectRoute must run first to set req.user, then checkRole checks the role
router.use("/system-settings/caller-id", protectRoute, checkRole(["ADMIN", "OWNER"]), callerIdRoutes)
router.use("/system-settings/call-settings", protectRoute, checkRole(["ADMIN", "OWNER"]), callSettingsRoutes)
router.use("/system-settings/misc-fields", protectRoute, checkRole(["ADMIN", "OWNER"]), miscFieldsRoutes)


export default router