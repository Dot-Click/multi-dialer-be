import { Router } from 'express';
import { ActionPlanController } from './controller';
import { protectRoute } from '@/middlewares/auth.middleware';

const router = Router();

// Middleware: Only ADMIN or OWNER (Blocked for AGENTS)
const authorizeAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role === 'ADMIN' || req.user?.role === 'OWNER') return next();
  return res.status(403).json({ message: "Forbidden: Admins only" });
};

router.get('/', protectRoute, ActionPlanController.list);
router.get('/:id', protectRoute, ActionPlanController.getOne);
router.post('/', authorizeAdmin, ActionPlanController.create);
router.put('/:id', authorizeAdmin, ActionPlanController.update);
router.delete('/:id', authorizeAdmin, ActionPlanController.remove);

export default router;