import { Router, Request, Response } from "express";
import { integrationController } from "./controller";

const router = Router();

// We wrap the calls in (req, res) => ... to ensure the return type is void
// 1. Create - POST /api/system-settings/integrations/create
router.post("/create", (req: Request, res: Response) => integrationController.create(req, res));

// 2. All - GET /api/system-settings/integrations/all
router.get("/all", (req: Request, res: Response) => integrationController.getAll(req, res));

// 3. My - GET /api/system-settings/integrations
router.get("/", (req: Request, res: Response) => integrationController.getMy(req, res));

// 4. By ID - GET /api/system-settings/integrations/{id}
router.get("/:id", (req: Request, res: Response) => integrationController.getById(req, res));

// 5. Update - PUT /api/system-settings/integrations/{id}
router.put("/:id", (req: Request, res: Response) => integrationController.update(req, res));

// 6. Delete - DELETE /api/system-settings/integrations/{id}
router.delete("/:id", (req: Request, res: Response) => integrationController.delete(req, res));

export default router;