
// import chatRouter from "./chat";
import { Router } from "express";
import scriptRoutes from "./library/scripts/index"
import smsRoutes from "./library/sms/index"

const router = Router()

// add routes here
router.use("/library/script",scriptRoutes)
router.use("/library/sms",smsRoutes)


export default router