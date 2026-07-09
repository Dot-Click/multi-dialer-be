import prisma from "../../lib/prisma";
import { getAddonSubscriptionIds } from "../../services/billingLedger.service";


export async function getUserOverviewInDb() {
  try {
    const [newUsers, totalAgents, activeSubscriptions, subscriptionRecords] = await Promise.all([
      // Customers only — count ADMIN accounts, excluding agent sub-accounts and OWNER.
      prisma.user.count({
        where: {
          role: "ADMIN",
        },
      }),
      prisma.user.count({
        where: {
          role: "AGENT",
        },
      }),
      prisma.userSubscription.count({
        where: {
          status: "ACTIVE",
          user: { role: { not: "OWNER" } }
        },
      }),
      prisma.userSubscription.findMany({
        where: { user: { role: { not: "OWNER" } } },
        select: { amount: true }
      }),
    ]);

    const totalRevenue = subscriptionRecords.reduce((sum, rec) => sum + parseFloat(rec.amount || "0"), 0);

    return {
      newUsers,
      totalAgents,
      activeSubscriptions,
      totalRevenue,
    };
  } catch (error: any) {
    throw error;
  }
}

export async function getNewAccountsOverTimeInDb(range: "THIS_MONTH" | "LAST_MONTH") {
  const now = new Date();
  let startOfMonth: Date;
  let endOfMonth: Date;

  if (range === "THIS_MONTH") {
    startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    startOfMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endOfMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  }

  const weekBoundaries = [
    {
      label: "Week 1",
      start: new Date(startOfMonth),
      end: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth(), 7, 23, 59, 59, 999),
    },
    {
      label: "Week 2",
      start: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth(), 8),
      end: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth(), 14, 23, 59, 59, 999),
    },
    {
      label: "Week 3",
      start: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth(), 15),
      end: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth(), 21, 23, 59, 59, 999),
    },
    {
      label: "Week 4",
      start: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth(), 22),
      end: new Date(endOfMonth),
    },
  ];

  const values = await Promise.all(
    weekBoundaries.map(async (week) => {
      return prisma.user.count({
        where: {
          // New accounts = customers who signed up, i.e. ADMIN users.
          // Excludes agent sub-accounts and the platform OWNER.
          role: "ADMIN",
          createdAt: {
            gte: week.start,
            lte: week.end,
          },
        },
      });
    })
  );

  return {
    labels: weekBoundaries.map((wb) => wb.label),
    values,
  };
}

export async function getAlertsInDb() {
  const now = new Date();
  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(now.getDate() + 7);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [
    expiringSubscriptions,
    newCustomers,
    activeSubscriptions,
    inactiveSubscriptions,
  ] = await Promise.all([
    // Expiring soon = ACTIVE subscriptions whose endDate falls within 7 days.
    // (Excludes already cancelled/expired subs and the platform OWNER.)
    prisma.userSubscription.count({
      where: {
        status: "ACTIVE",
        endDate: {
          gte: now,
          lte: sevenDaysFromNow,
        },
        user: { role: { not: "OWNER" } },
      },
    }),
    // New customers = ADMIN accounts created this month (the ones who sign up).
    prisma.user.count({
      where: {
        role: "ADMIN",
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    }),
    // Active = ADMIN customers who currently hold an ACTIVE subscription.
    prisma.user.count({
      where: {
        role: "ADMIN",
        userSubscriptions: { some: { status: "ACTIVE" } },
      },
    }),
    // Inactive = ADMIN customers with NO active subscription — this includes
    // those whose subscription is cancelled/expired AND those with no
    // subscription record at all.
    prisma.user.count({
      where: {
        role: "ADMIN",
        NOT: { userSubscriptions: { some: { status: "ACTIVE" } } },
      },
    }),
  ]);

  return {
    alerts: {
      expiringSubscriptions,
      newCustomers,
    },
    subscriptionStatus: {
      active: activeSubscriptions,
      inactive: inactiveSubscriptions,
    },
  };
}

export async function getUserSubscriptionDetailsInDb() {
  // Primary source: Billing (most recent row per user) for plan name and date.
  // Subscription lifecycle status comes from UserSubscription (ACTIVE/CANCELLED/EXPIRED).
  // Users with no billing row yet are still included via the User query.
  const users = await prisma.user.findMany({
    where: { role: { not: "OWNER" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      billings: {
        orderBy: { date: "desc" },
        take: 1,
        select: { planName: true, plan: true, date: true },
      },
      userSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, plan: true, createdAt: true },
      },
    },
  });

  return users.map((u) => {
    const billing = u.billings[0];
    const sub = u.userSubscriptions[0];
    return {
      plan: billing?.planName || billing?.plan || sub?.plan || "No Plan",
      status: u.status,
      createdAt: billing?.date || sub?.createdAt || u.createdAt,
      user: {
        fullName: u.fullName,
        email: u.email,
      },
    };
  });
}

export async function getUserSubscriptionStatusInDb() {
  const [active, inactive] = await Promise.all([
    // Active = ADMIN customers holding an ACTIVE subscription.
    prisma.user.count({
      where: {
        role: "ADMIN",
        userSubscriptions: { some: { status: "ACTIVE" } },
      },
    }),
    // Inactive = ADMIN customers with no active subscription (cancelled/expired
    // OR no subscription record at all).
    prisma.user.count({
      where: {
        role: "ADMIN",
        NOT: { userSubscriptions: { some: { status: "ACTIVE" } } },
      },
    }),
  ]);

  return { active, inactive };
}

export async function getRevenueGrowthInDb() {
  const now = new Date();
  const results = [];
  const addonIds = await getAddonSubscriptionIds();

  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

    // Contracted revenue = all billing rows (any status) for the month, normalised
    // to a monthly figure so YEARLY rows don't distort the bar chart. Excludes
    // add-on subscription rows — see getAllInvoices for the notIn/NULL note.
    const rows = await prisma.billing.findMany({
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: { notIn: addonIds } }],
      },
      select: { amount: true, billingCycle: true },
    });

    const revenue = rows.reduce((sum, r) => {
      const monthly = r.billingCycle === "YEARLY" ? r.amount / 12 : r.amount;
      return sum + monthly;
    }, 0);

    results.push({
      label: date.toLocaleString("default", { month: "short" }),
      revenue: parseFloat(revenue.toFixed(2)),
    });
  }

  return results;
}

// Collected revenue = money actually captured from PAID invoices in the Billing
// ledger. amount is stored as whole dollars — no unit conversion needed.
export async function getCollectedRevenueGrowthInDb() {
  const now = new Date();
  const results = [];
  const addonIds = await getAddonSubscriptionIds();

  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

    // Excludes add-on subscription rows — see getAllInvoices for the notIn/NULL note.
    const agg = await prisma.billing.aggregate({
      where: {
        status: "PAID",
        date: { gte: startOfMonth, lte: endOfMonth },
        OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: { notIn: addonIds } }],
      },
      _sum: { amount: true },
    });

    results.push({
      label: date.toLocaleString("default", { month: "short" }),
      revenue: agg._sum.amount || 0,
    });
  }

  return results;
}

function normalizeSubStatus(status: string): string {
  const upper = status.toUpperCase();
  if (upper === "CANCELED" || upper === "CANCEL") return "CANCELLED";
  return upper;
}

export async function getBillingReportDetailInDb() {
  // Pull all billing rows, newest first, with user + latest subscription status.
  // Excludes add-on subscription rows — see getAllInvoices for the notIn/NULL note.
  const addonIds = await getAddonSubscriptionIds();
  const billingRows = await prisma.billing.findMany({
    where: { OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: { notIn: addonIds } }] },
    include: {
      user: {
        include: {
          userSubscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true },
          },
        },
      },
    },
    orderBy: { date: "desc" },
  });

  // Aggregate per user: first row seen is the newest (plan name, invoice status).
  // Accumulate total billed and last payment date across all PAID rows.
  const grouped = new Map<string, {
    userName: string;
    email: string;
    plan: string;
    status: string;        // subscription status from UserSubscription
    invoiceStatus: string; // most recent billing row status
    totalBilled: number;
    lastPaymentDate: Date | null;
  }>();

  for (const row of billingRows) {
    const uid = row.userId;
    if (!grouped.has(uid)) {
      grouped.set(uid, {
        userName: row.user.fullName || "N/A",
        email: row.user.email,
        plan: row.planName || row.plan || "No Plan",
        status: normalizeSubStatus(row.user.userSubscriptions[0]?.status || "PENDING"),
        invoiceStatus: row.status,
        totalBilled: 0,
        lastPaymentDate: null,
      });
    }
    if (row.status === "PAID") {
      const entry = grouped.get(uid)!;
      entry.totalBilled += row.amount;
      if (!entry.lastPaymentDate || row.date > entry.lastPaymentDate) {
        entry.lastPaymentDate = row.date;
      }
    }
  }

  return Array.from(grouped.values()).map((g) => ({
    userName: g.userName,
    email: g.email,
    plan: g.plan,
    status: g.status,
    invoiceStatus: g.invoiceStatus,
    totalBilled: g.totalBilled,
    lastPayment: g.lastPaymentDate
      ? g.lastPaymentDate.toISOString().split("T")[0]
      : "—",
  }));
}

export async function getDashboardSummaryInDb() {
  const now = new Date();

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  // Excludes add-on subscription rows — see getAllInvoices for the notIn/NULL note.
  const addonIds = await getAddonSubscriptionIds();
  const notAddon = { OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: { notIn: addonIds } }] };

  const [
    currRevAgg, prevRevAgg,
    currActivePayers, prevActivePayers,
    currSignups, prevSignups,
    currCalls, prevCalls,
  ] = await Promise.all([
    // Total Revenue — sum of PAID billing rows by invoice date
    prisma.billing.aggregate({
      where: { status: "PAID", date: { gte: currentMonthStart, lte: currentMonthEnd }, ...notAddon },
      _sum: { amount: true },
    }),
    prisma.billing.aggregate({
      where: { status: "PAID", date: { gte: previousMonthStart, lte: previousMonthEnd }, ...notAddon },
      _sum: { amount: true },
    }),
    // Active Subscriptions — distinct users with a PAID invoice this month
    prisma.billing.groupBy({
      by: ["userId"],
      where: { status: "PAID", date: { gte: currentMonthStart, lte: currentMonthEnd }, ...notAddon },
    }),
    prisma.billing.groupBy({
      by: ["userId"],
      where: { status: "PAID", date: { gte: previousMonthStart, lte: previousMonthEnd }, ...notAddon },
    }),
    // New Signups — stays on User (signup is not a billing event)
    prisma.user.count({
      where: { createdAt: { gte: currentMonthStart, lte: currentMonthEnd }, role: { not: "OWNER" } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: previousMonthStart, lte: previousMonthEnd }, role: { not: "OWNER" } },
    }),
    // Total Calls — stays on CallRecord
    prisma.callRecord.count({
      where: { createdAt: { gte: currentMonthStart, lte: currentMonthEnd } },
    }),
    prisma.callRecord.count({
      where: { createdAt: { gte: previousMonthStart, lte: previousMonthEnd } },
    }),
  ]);

  return {
    revenue: {
      current: currRevAgg._sum.amount || 0,
      previous: prevRevAgg._sum.amount || 0,
    },
    activeSubscriptions: {
      current: currActivePayers.length,
      previous: prevActivePayers.length,
    },
    newSignups: { current: currSignups, previous: prevSignups },
    totalCallsProcessed: { current: currCalls, previous: prevCalls },
  };
}

export async function getBusinessOverviewInDb() {
  const [mrrRecords, activeSubscriptions, activeUsers, totalAgents] = await Promise.all([
    prisma.userSubscription.findMany({
      where: { status: "ACTIVE", user: { role: { not: "OWNER" } } },
      select: { amount: true, billingCycle: true },
    }),
    prisma.userSubscription.count({
      where: { status: "ACTIVE", user: { role: { not: "OWNER" } } },
    }),
    prisma.user.count({
      where: { status: "ACTIVE", role: { not: "OWNER" } },
    }),
    prisma.user.count({
      where: { status: "ACTIVE", role: "AGENT" },
    }),
  ]);

  const mrr = mrrRecords.reduce((sum, rec) => {
    const raw = parseFloat(rec.amount || "0");
    const monthly = rec.billingCycle === "YEARLY" ? raw / 12 : raw;
    return sum + monthly;
  }, 0);

  return {
    mrr: parseFloat(mrr.toFixed(2)),
    activeSubscriptions,
    activeUsers,
    totalAgents,
  };
}

export async function getTotalConnectionsInDb() {
  const now = new Date();
  const currStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const [current, previous] = await Promise.all([
    prisma.callRecord.count({ where: { status: "completed", startTime: { gte: currStart, lte: currEnd } } }),
    prisma.callRecord.count({ where: { status: "completed", startTime: { gte: prevStart, lte: prevEnd } } }),
  ]);
  return { current, previous };
}

export async function getAppointmentsSetInDb() {
  const now = new Date();
  const currStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const [current, previous] = await Promise.all([
    prisma.calendar.count({ where: { category: "APPOINTMENT", createdAt: { gte: currStart, lte: currEnd } } }),
    prisma.calendar.count({ where: { category: "APPOINTMENT", createdAt: { gte: prevStart, lte: prevEnd } } }),
  ]);
  return { current, previous };
}

export async function getAvgDaysSinceActiveInDb() {
  const users = await prisma.user.findMany({
    where: { role: "ADMIN", lastLogin: { not: null } },
    select: { lastLogin: true },
  });
  if (users.length === 0) return null;
  const now = Date.now();
  const totalDays = users.reduce((sum, u) => {
    return sum + (now - new Date(u.lastLogin!).getTime()) / (1000 * 60 * 60 * 24);
  }, 0);
  return parseFloat((totalDays / users.length).toFixed(1));
}

export async function getPlanChangesInDb() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [upgrades, downgrades, recent] = await Promise.all([
    prisma.subscriptionPlanChange.count({ where: { changeType: "UPGRADE",   changedAt: { gte: thirtyDaysAgo } } }),
    prisma.subscriptionPlanChange.count({ where: { changeType: "DOWNGRADE", changedAt: { gte: thirtyDaysAgo } } }),
    prisma.subscriptionPlanChange.findMany({
      orderBy: { changedAt: "desc" },
      take: 10,
      include: { user: { select: { fullName: true, email: true } } },
    }),
  ]);
  return { upgrades, downgrades, recent };
}

export async function getActiveUsersInDb() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [dau, wau] = await Promise.all([
    prisma.user.count({
      where: { lastLogin: { gte: startOfToday }, role: { not: "OWNER" } },
    }),
    prisma.user.count({
      where: { lastLogin: { gte: sevenDaysAgo }, role: { not: "OWNER" } },
    }),
  ]);

  return { dau, wau };
}

export async function getCallStatsInDb() {
  const now = new Date();
  const currStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [total, completed, failed, callsToday] = await Promise.all([
    prisma.callRecord.count({ where: { startTime: { gte: currStart, lte: currEnd } } }),
    prisma.callRecord.count({ where: { status: "completed", startTime: { gte: currStart, lte: currEnd } } }),
    prisma.callRecord.count({ where: { status: "failed", startTime: { gte: currStart, lte: currEnd } } }),
    prisma.callRecord.count({ where: { startTime: { gte: startOfToday } } }),
  ]);

  const successRate = total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0;
  const failedRate = total > 0 ? parseFloat(((failed / total) * 100).toFixed(1)) : 0;

  return { total, completed, failed, successRate, failedRate, callsToday };
}

export async function getRevenuePlansInDb() {
  const plans = ["STARTER", "PROFESSIONAL", "ENTERPRISE"];

  const allSubs = await prisma.userSubscription.findMany({
    where: {
      user: { role: { not: "OWNER" } }
    },
    select: {
      plan: true,
      amount: true
    }
  });

  const planRevenue = allSubs.reduce((acc: Record<string, number>, sub) => {
    const amount = parseFloat(sub.amount || "0");
    acc[sub.plan] = (acc[sub.plan] || 0) + amount;
    return acc;
  }, {});

  return {
    plans: plans.map(p => ({
      plan: p.charAt(0) + p.slice(1).toLowerCase(),
      amount: planRevenue[p] || 0
    }))
  };
}
