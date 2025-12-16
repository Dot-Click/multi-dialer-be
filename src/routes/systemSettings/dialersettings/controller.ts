import { Request, Response } from 'express';
import { DialerSettingService } from './service'; // Ensure path is correct

// FIX: Use Omit to exclude the default 'user' type to avoid conflict
interface AuthenticatedRequest extends Omit<Request, 'user'> {
  user?: {
    id: string;
    role: 'OWNER' | 'ADMIN' | 'AGENT' | 'USER'; 
  };
}

export const DialerSettingController = {
  /**
   * GET /api/system-settings/dialer-settings:systemSettingId
   */
  getSettings: async (req: Request, res: Response) => {
    try {
      // Cast req to our custom type to access the user safely
      const authReq = req as AuthenticatedRequest;
      const { systemSettingId } = authReq.params;
      const userRole = authReq.user?.role;

      // Access Control Check
      const allowedRoles = ['OWNER', 'ADMIN', 'AGENT'];
      if (!userRole || !allowedRoles.includes(userRole)) {
        return res.status(403).json({ message: 'Access Denied: Insufficient permissions.' });
      }

      const settings = await DialerSettingService.getDialerSettings(systemSettingId);

      if (!settings) {
        return res.status(404).json({ message: 'Dialer settings not found.' });
      }

      return res.status(200).json(settings);
    } catch (error) {
      console.error('Error fetching dialer settings:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },

  /**
   * POST /api/system-settings/dialer-settings:systemSettingId
   */
  updateSettings: async (req: Request, res: Response) => {
    try {
      // Cast req to our custom type
      const authReq = req as AuthenticatedRequest;
      const { systemSettingId } = authReq.params;
      const userRole = authReq.user?.role;

      // Access Control Check
      const allowedRoles = ['OWNER', 'ADMIN', 'AGENT'];
      if (!userRole || !allowedRoles.includes(userRole)) {
        return res.status(403).json({ message: 'Access Denied: Insufficient permissions.' });
      }

      // Destructure body to ensure only valid fields are passed
      const {
        useTimeShield,
        timeShieldStartTime,
        timeShieldEndTime,
        useAnswerNotificationTone,
        deleteDisconnectedNumbers,
        deleteFaxNumbers,
        useCallSessionTimer
      } = authReq.body;

      const updatedSettings = await DialerSettingService.upsertDialerSettings(systemSettingId, {
        useTimeShield,
        timeShieldStartTime,
        timeShieldEndTime,
        useAnswerNotificationTone,
        deleteDisconnectedNumbers,
        deleteFaxNumbers,
        useCallSessionTimer
      });

      return res.status(200).json(updatedSettings);
    } catch (error) {
      console.error('Error updating dialer settings:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },
};