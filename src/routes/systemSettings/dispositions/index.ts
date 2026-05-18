import { Router } from "express";
import { 
    getDispositions, 
    createDisposition, 
    updateDisposition, 
    deleteDisposition, 
    reorderDispositions,
    applyDisposition
} from "./controller";

const router = Router();

router.get("/", getDispositions as any);
router.post("/", createDisposition as any);
router.post("/apply", applyDisposition as any);
router.put("/reorder", reorderDispositions as any);
router.put("/:id", updateDisposition as any);
router.delete("/:id", deleteDisposition as any);

export default router;
