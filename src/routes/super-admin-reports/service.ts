import prisma from "../../lib/prisma";


export async function getUserOverviewInDb() {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [newUsers, totalAgents, activeSubscriptions, revenueAggregation] = await Promise.all([
      prisma.user.count({
        where: {
          role: {
            not: "OWNER",
          },
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
        },
      }),
      prisma.billing.aggregate({
        where: {
          date: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    return {
      newUsers,
      totalAgents,
      activeSubscriptions,
      currentMonthRevenue: revenueAggregation._sum.amount || 0,
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
    prisma.contact.count({
      where: {
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
  return prisma.userSubscription.findMany({
    select: {
      plan: true,
      status: true,
      createdAt: true,
      user: {
        select: {
          fullName: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
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
  return prisma.userSubscription.findMany({
    select: {
      plan: true,
      createdAt: true,
      status: true,
      amount: true,
      user: {
        select: {
          fullName: true,
          email: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
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
