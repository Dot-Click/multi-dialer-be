import { User } from "@prisma/client";

/**
 * Checks if a user's account should have restricted access to specific features
 * (Dialer and SMS Inbox) based on trial expiration and subscription status.
 */
export const isFeatureLocked = (user: any): boolean => {
  if (!user) return false;
  
  // Logic: Locked if trial has expired AND they are not subscribed
  return user.trialStatus === "EXPIRED" && !user.isSubscribed;
};
