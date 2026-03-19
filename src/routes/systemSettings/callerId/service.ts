import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createCallerIdSchema } from "../../../schemas/callerId.schema";

export async function insertCallerIdInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createCallerIdSchema, payload) as any;

    if (!('data' in result)) {
      throw { errors: result };
    }

    const data = result.data;
    const { agentIds, ...callerIdData } = data;

    // Get or create user's systemSettings
    let systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    // If systemSettings doesn't exist, create it (fallback in case auto-creation didn't work)
    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({
        data: {
          userId,
        },
      });
    }

    // Insert CallerId into DB with systemSettingId
    const callerId = await prisma.callerId.create({
      data: {
        ...callerIdData,
        systemSettingId: systemSettings.id,
        agents: agentIds ? {
          connect: agentIds.map((id: string) => ({ id }))
        } : undefined
      },
      include: {
        agents: {
          select: {
            id: true,
            fullName: true,
            email: true,
          }
        }
      }
    });

    return callerId;
  } catch (error) {
    throw error;
  }
}

const COOLDOWN_MS = 20 * 60 * 1000;

export async function resolveAdminId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, createdById: true },
  });

  console.log("[resolveAdminId] userId:", userId, "→ user:", user);

  if (!user) throw new Error("User not found");
  if (user.role === "AGENT" && user.createdById) {
    console.log("[resolveAdminId] AGENT → resolving to adminId:", user.createdById);
    return user.createdById;
  }
  console.log("[resolveAdminId] ADMIN/OWNER → using own id:", userId);
  return userId;
}

export async function recordCallAndRotateIfNeeded(
  adminId: string,
  callerNumber: string,
  maxCallsPerCid: number
) {
  console.log("─".repeat(60));
  console.log("[recordCall] START");
  console.log("[recordCall] adminId:", adminId);
  console.log("[recordCall] callerNumber:", callerNumber);
  console.log("[recordCall] maxCallsPerCid:", maxCallsPerCid);

  // ── Step 1: Find the SystemSetting for this admin ─────────────────────────
  const systemSetting = await prisma.system_Setting.findFirst({
    where: { userId: adminId },
    select: { id: true },
  });

  console.log("[recordCall] systemSetting:", systemSetting);

  if (!systemSetting) {
    console.error("[recordCall] ❌ No SystemSetting found for adminId:", adminId);
    return { callCount: 0, isFrozen: false, unfreezeAt: null, secondsRemaining: 0, rotated: false };
  }

  // ── Step 2: Find CallerId by twillioNumber + systemSettingId ──────────────
  // Using systemSettingId directly — avoids the nested relation filter issue
  const callerIdRow = await prisma.callerId.findFirst({
    where: {
      twillioNumber:   callerNumber,
      systemSettingId: systemSetting.id,
    },
    select: {
      id:            true,
      callCount:     true,
      numberOfLines: true, // ← now fetching this
      frozenAt:      true,
      unfreezeAt:    true,
      updatedAt:     true, // ← now fetching this
      twillioNumber: true,
      label:         true,
    },
  });

  console.log("[recordCall] callerIdRow:", callerIdRow);

  if (!callerIdRow) {
    console.error("[recordCall] ❌ No CallerId found for twillioNumber:", callerNumber, "systemSettingId:", systemSetting.id);

    // ── Diagnostic: show ALL callerIds for this systemSetting ────────────────
    const allCallerIds = await prisma.callerId.findMany({
      where: { systemSettingId: systemSetting.id },
      select: { id: true, label: true, twillioNumber: true },
    });
    console.log("[recordCall] 📋 All CallerIds for this admin:", JSON.stringify(allCallerIds, null, 2));
    console.log("[recordCall] 🔍 You sent callerNumber:", JSON.stringify(callerNumber));
    console.log("[recordCall] 🔍 DB twillioNumbers:", allCallerIds.map(c => JSON.stringify(c.twillioNumber)));

    return { callCount: 0, isFrozen: false, unfreezeAt: null, secondsRemaining: 0, rotated: false };
  }

  // ── Step 3: Increment and freeze if needed ────────────────────────────────
  const now = new Date();

  // --- IDLE RESET LOGIC ---
  // If the number hasn't been used for 20 mins, reset its count to 0.
  // This prevents "rotated after 1 call" issues when starting a new session
  // after a long break, even if the previous session didn't hit the limit.
  let callCount = callerIdRow.callCount ?? 0;
  const lastUsed = callerIdRow.updatedAt;
  if (lastUsed && (now.getTime() - lastUsed.getTime()) > COOLDOWN_MS) {
    console.log("[recordCall] 🟢 Idle reset: Last used > 20 mins ago. Resetting callCount to 0.");
    callCount = 0;
  }

  // Determine threshold: use the record's specific limit if it's greater than 1,
  // otherwise fallback to the session-wide limit passed from the frontend.
  const threshold = (callerIdRow.numberOfLines && callerIdRow.numberOfLines > 1)
    ? Math.max(maxCallsPerCid, callerIdRow.numberOfLines)
    : maxCallsPerCid;

  const newCount = callCount + 1;
  let isFrozen   = false;
  let unfreezeAt: Date | null = null;
  let rotated    = false;

  console.log("[recordCall] current callCount:", callCount, "→ newCount:", newCount, "threshold:", threshold);

  if (newCount >= threshold) {
    unfreezeAt = new Date(now.getTime() + COOLDOWN_MS);
    isFrozen   = true;
    rotated    = true;
    console.log("[recordCall] 🔴 FREEZING callerId. unfreezeAt:", unfreezeAt);
  }

  const updated = await prisma.callerId.update({
    where: { id: callerIdRow.id },
    data: {
      callCount:  newCount,
      frozenAt:   rotated ? now        : (callCount === 0 ? null : undefined), // Reset states if idle reset happened
      unfreezeAt: rotated ? unfreezeAt : (callCount === 0 ? null : undefined),
    },
  });

  console.log("[recordCall] ✅ DB updated:", {
    id:         updated.id,
    callCount:  updated.callCount,
    frozenAt:   updated.frozenAt,
    unfreezeAt: updated.unfreezeAt,
  });
  console.log("─".repeat(60));

  const unfreezeMs       = unfreezeAt?.getTime() ?? null;
  const secondsRemaining = unfreezeMs ? Math.max(0, Math.ceil((unfreezeMs - Date.now()) / 1000)) : 0;

  return { callCount: newCount, isFrozen, unfreezeAt: unfreezeMs, secondsRemaining, rotated };
}

export async function getCooldownStatus(
  adminId: string,
  callerNumbers: string[]
) {
  console.log("[getCooldownStatus] adminId:", adminId, "numbers:", callerNumbers);

  const systemSetting = await prisma.system_Setting.findFirst({
    where: { userId: adminId },
    select: { id: true },
  });

  if (!systemSetting) {
    console.error("[getCooldownStatus] ❌ No SystemSetting for adminId:", adminId);
    return Object.fromEntries(callerNumbers.map((n) => [n, { callCount: 0, isFrozen: false, unfreezeAt: null, secondsRemaining: 0 }]));
  }

  const now = new Date();

  const callerIdRows = await prisma.callerId.findMany({
    where: {
      twillioNumber:   { in: callerNumbers },
      systemSettingId: systemSetting.id,
    },
    select: {
      id:            true,
      twillioNumber: true,
      callCount:     true,
      frozenAt:      true,
      unfreezeAt:    true,
      updatedAt:     true,
    },
  });

  console.log("[getCooldownStatus] found rows:", callerIdRows);

  // Auto-expire
  // 1. Cooldowns that have actually finished their time
  const expiredCooldowns = callerIdRows.filter((r) => r.unfreezeAt !== null && r.unfreezeAt <= now);
  // 2. Idle numbers that haven't been used for 20 mins (resets callCount even if not frozen)
  const idleNumbers = callerIdRows.filter((r) =>
    r.unfreezeAt === null && // Not currently frozen
    r.callCount > 0 && // Has a count to reset
    r.updatedAt && (now.getTime() - r.updatedAt.getTime()) > COOLDOWN_MS
  );

  const resetBatch = [...expiredCooldowns, ...idleNumbers];

  if (resetBatch.length > 0) {
    console.log("[getCooldownStatus] 🟢 Resetting counts for:", resetBatch.map((r) => r.twillioNumber));
    await prisma.callerId.updateMany({
      where: { id: { in: resetBatch.map((r) => r.id) } },
      data:  { callCount: 0, frozenAt: null, unfreezeAt: null },
    });
    // Update local objects for the response
    resetBatch.forEach((r) => { r.callCount = 0; r.frozenAt = null; r.unfreezeAt = null; });
  }

  const rowMap = new Map(callerIdRows.map((r) => [r.twillioNumber, r]));
  const result: Record<string, any> = {};

  for (const num of callerNumbers) {
    const row        = rowMap.get(num);
    const isFrozen   = !!row?.frozenAt && !!row?.unfreezeAt && row.unfreezeAt > now;
    const unfreezeMs = isFrozen && row?.unfreezeAt ? row.unfreezeAt.getTime() : null;
    const secondsRemaining = unfreezeMs ? Math.max(0, Math.ceil((unfreezeMs - Date.now()) / 1000)) : 0;

    result[num] = {
      callCount: row?.callCount ?? 0,
      isFrozen,
      unfreezeAt: unfreezeMs,
      secondsRemaining,
    };
  }

  console.log("[getCooldownStatus] result:", result);
  return result;
}