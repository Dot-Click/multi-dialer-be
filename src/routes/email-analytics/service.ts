import prisma from "../../lib/prisma";
import { EmailStatus } from "@prisma/client";

// ── Summary ───────────────────────────────────────────────────────────────────

export async function getEmailAnalyticsSummary() {
  const [
    totalSent,
    totalFailed,
    queuePending,
    queueDead,
    suppressions,
    delivered,
    opened,
    clicked,
    hardBounces,
    softBounces,
  ] = await Promise.all([
    prisma.emailLog.count({ where: { status: EmailStatus.SENT } }),
    prisma.emailLog.count({ where: { status: EmailStatus.FAILED } }),
    prisma.emailQueue.count({ where: { status: "PENDING" } }),
    prisma.emailQueue.count({ where: { status: "DEAD" } }),
    prisma.emailSuppression.groupBy({ by: ["reason"], _count: { id: true } }),
    prisma.emailLog.count({ where: { deliveredAt: { not: null } } }),
    prisma.emailLog.count({ where: { openedAt: { not: null } } }),
    prisma.emailLog.count({ where: { clickedAt: { not: null } } }),
    prisma.emailLog.count({ where: { bounceType: "HARD" } }),
    prisma.emailLog.count({ where: { bounceType: "SOFT" } }),
  ]);

  const total = totalSent + totalFailed;
  const deliveryRate = total > 0 ? Math.round((totalSent / total) * 1000) / 10 : 0;
  // Open/click rates are conventionally measured against delivered messages,
  // not total sent — a message that never delivered couldn't have been opened.
  const rateOf = (numerator: number) =>
    delivered > 0 ? Math.round((numerator / delivered) * 1000) / 10 : 0;

  const suppCount = (reason: string) =>
    suppressions.find((s) => s.reason === reason)?._count.id ?? 0;

  return {
    totalSent,
    totalFailed,
    total,
    deliveryRate,
    engagement: {
      delivered,
      opened,
      clicked,
      openRate: rateOf(opened),
      clickRate: rateOf(clicked),
      hardBounces,
      softBounces,
      bounceRate: total > 0 ? Math.round((hardBounces / total) * 1000) / 10 : 0,
    },
    queue: {
      pending: queuePending,
      dead: queueDead,
    },
    suppressions: {
      bounce:      suppCount("BOUNCE"),
      complaint:   suppCount("COMPLAINT"),
      unsubscribe: suppCount("UNSUBSCRIBE"),
      total:       suppressions.reduce((n, s) => n + s._count.id, 0),
      complaintRate: total > 0 ? Math.round((suppCount("COMPLAINT") / total) * 1000) / 10 : 0,
    },
  };
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export async function getEmailTimeline(days = 30) {
  // Raw SQL is necessary to efficiently GROUP BY calendar date in PostgreSQL.
  //
  // Two things previously broke this query:
  //  - `created_at` doesn't exist as a column — Prisma's default mapping made
  //    it "createdAt" (like the other camelCase columns already quoted
  //    below), so Postgres rejected the query outright with
  //    `column "created_at" does not exist` before it could run at all.
  //  - `${days} || ' days'` bound `days` as an integer parameter, and
  //    Postgres has no `||` (concat) operator for `integer || text`. Fixed by
  //    multiplying an INTERVAL literal instead, which is well-typed either way.
  const rows = await prisma.$queryRaw<
    { date: Date; sent: bigint; failed: bigint; delivered: bigint; opened: bigint; clicked: bigint; bounced: bigint }[]
  >`
    SELECT
      DATE("createdAt")                                         AS date,
      COUNT(*) FILTER (WHERE status = 'SENT')::BIGINT           AS sent,
      COUNT(*) FILTER (WHERE status = 'FAILED')::BIGINT         AS failed,
      COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::BIGINT AS delivered,
      COUNT(*) FILTER (WHERE "openedAt" IS NOT NULL)::BIGINT    AS opened,
      COUNT(*) FILTER (WHERE "clickedAt" IS NOT NULL)::BIGINT   AS clicked,
      COUNT(*) FILTER (WHERE "bounceType" IS NOT NULL)::BIGINT  AS bounced
    FROM email_logs
    WHERE "createdAt" >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY DATE("createdAt")
    ORDER BY date ASC
  `;

  type DayMetrics = { sent: number; failed: number; delivered: number; opened: number; clicked: number; bounced: number };
  const zero: DayMetrics = { sent: 0, failed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 };

  const byDate = new Map<string, DayMetrics>(
    rows.map((r) => [
      r.date.toISOString().split("T")[0],
      {
        sent:      Number(r.sent),
        failed:    Number(r.failed),
        delivered: Number(r.delivered),
        opened:    Number(r.opened),
        clicked:   Number(r.clicked),
        bounced:   Number(r.bounced),
      },
    ])
  );

  // The GROUP BY only produces rows for days that had at least one email —
  // days with zero activity are simply absent, which turns a sparse range
  // into a broken/discontinuous line on the chart. Fill every day in the
  // requested range explicitly, defaulting to zero.
  const result: (DayMetrics & { date: string })[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    result.push({ date: dateStr, ...(byDate.get(dateStr) ?? zero) });
  }

  return result;
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
        id:          true,
        to:          true,
        from:        true,
        subject:     true,
        status:      true,
        error:       true,
        messageId:   true,
        createdAt:   true,
        deliveredAt: true,
        openedAt:    true,
        openCount:   true,
        clickedAt:   true,
        clickCount:  true,
        bounceType:  true,
        user:        { select: { fullName: true, email: true } },
        template:    { select: { templateName: true } },
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
