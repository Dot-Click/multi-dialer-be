import { Router, RequestHandler } from 'express';
import { DialerSettingController } from './controller';

const router = Router();

// Route to Get Settings
router.get('/:systemSettingId', (DialerSettingController.getSettings as unknown) as RequestHandler);

router.post('/:systemSettingId', (DialerSettingController.updateSettings as unknown) as RequestHandler);

export default router;