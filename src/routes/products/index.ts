import { Router, Request, Response, NextFunction } from "express";
import { createProduct, deleteProduct, getAllProducts, getProductById, updateProduct } from "./controller";
import { checkRole, protectRoute } from "../../middlewares/auth.middleware";
import { validateData } from "../../middlewares/vald.middleware";
import { createProductSchema } from "../../zod/user.schema";
import { upload } from "../../middlewares/multer.middleware";
const router = Router()

router.get("/", protectRoute, getAllProducts)
router.get("/:id", protectRoute, getProductById)
router.post("/create", protectRoute, checkRole(["user"]), upload, createProduct)
router.patch("/update/:id", protectRoute, checkRole(["user"]), upload, updateProduct)
router.delete("/delete/:id", protectRoute, checkRole(["user"]), deleteProduct)

export default router