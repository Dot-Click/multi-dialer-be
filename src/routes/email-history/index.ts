import { Router } from "express";
import { getEmailHistoryForContact, getAllEmailHistory } from "./controller";
import { protectRoute } from "../../middlewares/auth.middleware";

const emailHistoryRouter = Router();

// Protect all routes
emailHistoryRouter.use(protectRoute as any);

// Endpoints
emailHistoryRouter.get("/", getAllEmailHistory as any);
emailHistoryRouter.get("/contact/:contactId", getEmailHistoryForContact as any);

export default emailHistoryRouter;
