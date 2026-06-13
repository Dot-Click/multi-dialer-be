import prisma from "../../lib/prisma";


export async function getUserOverviewInDb() {
  try {
    const [newUsers, totalAgents, activeSubscriptions, subscriptionRecords] = await Promise.all([
      prisma.user.count({
        where: {
          role: { not: "OWNER" },
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
    prisma.userSubscription.count({
      where: {
        endDate: {
          gte: now,
          lte: sevenDaysFromNow,
        },
      },
    }),
    prisma.user.count({
      where: {
        role: { not: "OWNER" },
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    }),
    prisma.userSubscription.count({
      where: {
        status: "ACTIVE",
      },
    }),
    prisma.userSubscription.count({
      where: {
        status: {
          not: "ACTIVE",
        },
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
  const users = await prisma.user.findMany({
    where: {
      role: { not: "OWNER" },
    },
    include: {
      userSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return users.map((u) => {
    const sub = u.userSubscriptions[0];
    return {
      plan: sub?.plan || "No Plan",
      status: sub?.status || "PENDING",
      createdAt: sub?.createdAt || u.createdAt,
      user: {
        fullName: u.fullName,
        email: u.email,
      },
    };
  });
}

export async function getUserSubscriptionStatusInDb() {
  const [active, inactive] = await Promise.all([
    prisma.userSubscription.count({
      where: {
        status: "ACTIVE",
      },
    }),
    prisma.userSubscription.count({
      where: {
        status: {
          not: "ACTIVE",
        },
      },
    }),
  ]);

  return { active, inactive };
}

export async function getRevenueGrowthInDb() {
  const now = new Date();
  const results = [];

  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = date.getMonth();
    const year = date.getFullYear();

    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const aggregation = await prisma.billing.aggregate({
      where: {
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        amount: true,
      },
    });

    results.push({
      label: date.toLocaleString("default", { month: "short" }),
      revenue: aggregation._sum.amount || 0,
    });
  }

  return results;
}

export async function getBillingReportDetailInDb() {
  const users = await prisma.user.findMany({
    where: {
      role: { not: "OWNER" },
    },
    include: {
      userSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return users.map((u) => {
    const sub = u.userSubscriptions[0];
    return {
      plan: sub?.plan || "No Plan",
      createdAt: sub?.createdAt || u.createdAt,
      status: sub?.status || "PENDING",
      amount: sub?.amount || "0",
      user: {
        fullName: u.fullName,
        email: u.email,
        status: u.status,
      },
    };
  });
}

export async function getDashboardSummaryInDb() {
  const now = new Date();

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const [
    currRevRecords, prevRevRecords,
    currSubs, prevSubs,
    currSignups, prevSignups,
    currCalls, prevCalls
  ] = await Promise.all([
    // Revenue (Fetching records to sum in memory because amount is String)
    prisma.userSubscription.findMany({
      where: { createdAt: { gte: currentMonthStart, lte: currentMonthEnd } },
      select: { amount: true }
    }),
    prisma.userSubscription.findMany({
      where: { createdAt: { gte: previousMonthStart, lte: previousMonthEnd } },
      select: { amount: true }
    }),
    // Active Subscriptions
    prisma.userSubscription.count({
      where: { status: "ACTIVE", createdAt: { gte: currentMonthStart, lte: currentMonthEnd } }
    }),
    prisma.userSubscription.count({
      where: { status: "ACTIVE", createdAt: { gte: previousMonthStart, lte: previousMonthEnd } }
    }),
    // New Signups
    prisma.user.count({
      where: { createdAt: { gte: currentMonthStart, lte: currentMonthEnd }, role: { not: "OWNER" } }
    }),
    prisma.user.count({
      where: { createdAt: { gte: previousMonthStart, lte: previousMonthEnd }, role: { not: "OWNER" } }
    }),
    // Total Calls
    prisma.callRecord.count({
      where: { createdAt: { gte: currentMonthStart, lte: currentMonthEnd } }
    }),
    prisma.callRecord.count({
      where: { createdAt: { gte: previousMonthStart, lte: previousMonthEnd } }
    })
  ]);

  const sumAmount = (records: { amount: string | null }[]) =>
    records.reduce((sum, rec) => sum + parseFloat(rec.amount || "0"), 0);

  return {
    revenue: {
      current: sumAmount(currRevRecords),
      previous: sumAmount(prevRevRecords)
    },
    activeSubscriptions: {
      current: currSubs,
      previous: prevSubs
    },
    newSignups: {
      current: currSignups,
      previous: prevSignups
    },
    totalCallsProcessed: {
      current: currCalls,
      previous: prevCalls
    }
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

export async function getChurnRateInDb() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Subscriptions that were active at the start of this month:
  // started before the 1st, and not cancelled/expired before the 1st.
  const [activeAtStart, cancelledThisMonth] = await Promise.all([
    prisma.userSubscription.count({
      where: {
        startDate: { lt: monthStart },
        user: { role: { not: "OWNER" } },
        // Exclude rows already churned before this month began
        NOT: {
          AND: [
            { status: { in: ["CANCELLED", "EXPIRED"] } },
            { updatedAt: { lt: monthStart } },
          ],
        },
      },
    }),
    prisma.userSubscription.count({
      where: {
        status: { in: ["CANCELLED", "EXPIRED"] },
        updatedAt: { gte: monthStart, lte: monthEnd },
        user: { role: { not: "OWNER" } },
      },
    }),
  ]);

  const churnRate =
    activeAtStart > 0
      ? parseFloat(((cancelledThisMonth / activeAtStart) * 100).toFixed(2))
      : 0;

  return {
    churnRate,
    cancelledThisMonth,
    activeAtStart,
    month: monthStart.toLocaleString("default", { month: "long", year: "numeric" }),
  };
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
