import { User } from "@prisma/client";
import prisma from "../lib/prisma";

/**
 * Checks if a user's account should have restricted access to specific features
 * (Dialer and SMS Inbox) based on trial expiration and subscription status.
 */
export const isFeatureLocked = (user: any): boolean => {
  if (!user) return false;

  // Logic: Locked if trial has expired AND they are not subscribed
  return user.trialStatus === "EXPIRED" && !user.isSubscribed;
};

/**
 * Resolves the effective lock state for a user, accounting for account ownership.
 * Subscriptions live on the account OWNER/ADMIN — agents (created by an admin via
 * `createdById`) inherit their admin's subscription status. So an agent is locked
 * whenever the admin who owns their account is locked.
 *
 * Returns { locked, canPurchase }:
 *  - locked: whether dialer/feature access should be blocked
 *  - canPurchase: whether THIS user is allowed to buy/manage the subscription
 *                 (only the account owner — ADMIN/OWNER — can; agents cannot)
 */
export const getEffectiveLock = async (
  userId: string
): Promise<{ locked: boolean; canPurchase: boolean }> => {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, trialStatus: true, isSubscribed: true, createdById: true },
  });

  if (!me) return { locked: false, canPurchase: false };

  const canPurchase = me.role === "ADMIN" || me.role === "OWNER";

  // Agents inherit the owning admin's subscription status.
  let owner: { trialStatus: any; isSubscribed: boolean } = me;
  if (me.role === "AGENT" && me.createdById) {
    const admin = await prisma.user.findUnique({
      where: { id: me.createdById },
      select: { trialStatus: true, isSubscribed: true },
    });
    if (admin) owner = admin;
  }

  return { locked: isFeatureLocked(owner), canPurchase };
};
