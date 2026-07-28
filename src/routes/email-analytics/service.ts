import prisma from "../../lib/prisma";
import { EmailStatus } from "@prisma/client";

// ── Summary ───────────────────────────────────────────────────────────────────

export async function getEmailAnalyticsSummary() {
  const [totalSent, totalFailed, queuePending, queueDead, suppressions] =
    await Promise.all([
      prisma.emailLog.count({ where: { status: EmailStatus.SENT } }),
      prisma.emailLog.count({ where: { status: EmailStatus.FAILED } }),
      prisma.emailQueue.count({ where: { status: "PENDING" } }),
      prisma.emailQueue.count({ where: { status: "DEAD" } }),
      prisma.emailSuppression.groupBy({ by: ["reason"], _count: { id: true } }),
    ]);

  const total = totalSent + totalFailed;
  const deliveryRate = total > 0 ? Math.round((totalSent / total) * 1000) / 10 : 0;

  const suppCount = (reason: string) =>
    suppressions.find((s) => s.reason === reason)?._count.id ?? 0;

  return {
    totalSent,
    totalFailed,
    total,
    deliveryRate,
    queue: {
      pending: queuePending,
      dead: queueDead,
    },
    suppressions: {
      bounce:      suppCount("BOUNCE"),
      complaint:   suppCount("COMPLAINT"),
      unsubscribe: suppCount("UNSUBSCRIBE"),
      total:       suppressions.reduce((n, s) => n + s._count.id, 0),
    },
  };
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export async function getEmailTimeline(days = 30) {
  // Raw SQL is necessary to efficiently GROUP BY calendar date in PostgreSQL.
  const rows = await prisma.$queryRaw<
    { date: Date; sent: bigint; failed: bigint }[]
  >`
    SELECT
      DATE(created_at)                                    AS date,
      COUNT(*) FILTER (WHERE status = 'SENT')::BIGINT     AS sent,
      COUNT(*) FILTER (WHERE status = 'FAILED')::BIGINT   AS failed
    FROM email_logs
    WHERE created_at >= NOW() - (${days} || ' days')::INTERVAL
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  return rows.map((r) => ({
    date:   r.date.toISOString().split("T")[0],
    sent:   Number(r.sent),
    failed: Number(r.failed),
  }));
}

// ── Paginated logs ────────────────────────────────────────────────────────────

export async function getEmailLogs(opts: {
  page:    number;
  limit:   number;
  status?: EmailStatus;
  search?: string;
  days?:   number;
}) {
  const { page, limit, status, search, days } = opts;

  const where: any = {};
  if (status)  where.status = status;
  if (search)  where.to = { contains: search, mode: "insensitive" };
  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    where.createdAt = { gte: since };
  }

  const [logs, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      select: {
        id:        true,
        to:        true,
        from:      true,
        subject:   true,
        status:    true,
        error:     true,
        messageId: true,
        createdAt: true,
        user:      { select: { fullName: true, email: true } },
        template:  { select: { templateName: true } },
      },
      orderBy: { createdAt: "desc" },
      skip:  (page - 1) * limit,
      take:  limit,
    }),
    prisma.emailLog.count({ where }),
  ]);

  return {
    logs,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
}

// ── Dead-letter queue ─────────────────────────────────────────────────────────

export async function getDeadLetterQueue(opts: { page: number; limit: number }) {
  const { page, limit } = opts;

  const where = { status: "DEAD" as const };

  const [items, total] = await Promise.all([
    prisma.emailQueue.findMany({
      where,
      select: {
        id:         true,
        to:         true,
        subject:    true,
        attempts:   true,
        maxAttempts: true,
        lastError:  true,
        createdAt:  true,
        updatedAt:  true,
      },
      orderBy: { updatedAt: "desc" },
      skip:  (page - 1) * limit,
      take:  limit,
    }),
    prisma.emailQueue.count({ where }),
  ]);

  return {
    items,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
}
