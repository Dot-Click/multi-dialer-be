import { Router, RequestHandler } from 'express';
import { DialerSettingController } from './controller';

const router = Router();

// Route to Get Settings
router.get(
  '/:systemSettingId', 
  // Fix: Cast to unknown first, then RequestHandler
  (DialerSettingController.getSettings as unknown) as RequestHandler
);
 
router.post(
  '/:systemSettingId', 
  // Fix: Cast to unknown first, then RequestHandler
  (DialerSettingController.updateSettings as unknown) as RequestHandler
);

export default router;