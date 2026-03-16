import { Router } from "express";
import {
  createCompany,
  deleteCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  getMyCompany,
} from "./controller";

const router = Router();

router.post("/create", createCompany);
router.get("/", getAllCompanies);
router.get("/my-company", getMyCompany);
router.get("/:id", getCompanyById);
router.put("/:id", updateCompany);
router.delete("/:id", deleteCompany);

export default router;
