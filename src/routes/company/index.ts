import { Router } from "express";
import { createCompany, deleteCompany, getAllCompanies, getCompanyById, updateCompany } from "./controller";
import { checkRole } from "../../middlewares/auth.middleware";

const router = Router();


router.post("/create", checkRole(["ADMIN", "OWNER"]), createCompany);
router.get("/", getAllCompanies);
router.get("/:id", getCompanyById);
router.put("/:id", updateCompany);
router.delete("/:id", deleteCompany);

export default router;


