import cron from "node-cron";
import prisma from "../lib/prisma";

/**
 * Callback Due Job
 *
 * Runs every 60 seconds and drives the lifecycle of scheduled callbacks:
 *  1. PENDING callbacks whose scheduledAt falls in [now - 1m, now + 2m] are
 *     flagged DUE so the real-time layer (Phase 2) can surface them to the
 *     assigned agent and interrupt their dialer session. The agentId is already
 *     stored on each Callback row, so the emitter can target the right agent.
 *  2. PENDING callbacks older than 10 minutes are marked MISSED — the agent
 *     never acted on them. (DUE is set by this job; COMPLETED only by the agent.)
 */
export const startCallbackDueJob = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - 1 * 60 * 1000); // now - 1 min
      const windowEnd = new Date(now.getTime() + 2 * 60 * 1000); // now + 2 min
      const missedCutoff = new Date(now.getTime() - 10 * 60 * 1000); // now - 10 min

      // 1. Expire stale PENDING callbacks (agent didn't respond in time).
      const missed = await prisma.callback.updateMany({
        where: { status: "PENDING", scheduledAt: { lt: missedCutoff } },
        data: { status: "MISSED" },
      });
      if (missed.count > 0) {
        console.log(`[Job] callbackDue: marked ${missed.count} callback(s) MISSED`);
      }

      // 2. Flag callbacks coming due. Fetch first so we can hand agentIds to the
      //    real-time layer, then flip them to DUE in one bulk update.
      const dueCallbacks = await prisma.callback.findMany({
        where: {
          status: "PENDING",
          scheduledAt: { gte: windowStart, lte: windowEnd },
        },
        select: { id: true, agentId: true, contactId: true, scheduledAt: true },
      });

      if (dueCallbacks.length > 0) {
        await prisma.callback.updateMany({
          where: { id: { in: dueCallbacks.map((c) => c.id) } },
          data: { status: "DUE" },
        });

        // Phase 2 hook: emit each DUE callback to its agent via the real-time
        // layer. agentId is on every record so the emitter can target precisely.
        for (const cb of dueCallbacks) {
          console.log(`[Job] callbackDue: callback ${cb.id} is DUE for agent ${cb.agentId}`);
        }
      }
    } catch (error) {
      console.error("[Job] Critical error in Callback Due Job:", error);
    }
  });
};
