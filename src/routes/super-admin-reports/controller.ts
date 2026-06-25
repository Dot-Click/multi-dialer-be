import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import {
  getUserOverviewInDb,
  getNewAccountsOverTimeInDb,
  getAlertsInDb,
  getUserSubscriptionDetailsInDb,
  getUserSubscriptionStatusInDb,
  getRevenueGrowthInDb,
  getBillingReportDetailInDb,
  getDashboardSummaryInDb,
  getBusinessOverviewInDb,
  getRevenuePlansInDb,
  getCollectedRevenueGrowthInDb,
  getTotalConnectionsInDb,
  getAppointmentsSetInDb,
  getAvgDaysSinceActiveInDb,
  getPlanChangesInDb,
} from "./service";

export const getUserOverview = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const data = await getUserOverviewInDb();
    successResponse(res, 200, "User overview fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const newAccountsOverTime = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const range = (req.query.range as string) || "THIS_MONTH";

    if (range !== "THIS_MONTH" && range !== "LAST_MONTH") {
      errorResponse(res, "Invalid range. Use THIS_MONTH or LAST_MONTH.", 400);
      return;
    }

    const chartData = await getNewAccountsOverTimeInDb(
      range as "THIS_MONTH" | "LAST_MONTH",
    );

    successResponse(res, 200, "New accounts analytics fetched successfully", {
      success: true,
      range,
      chart: chartData,
    });
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const alerts = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getAlertsInDb();
    successResponse(res, 200, "Alerts fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};
export const userSubscriptionDetails = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rawData = await getUserSubscriptionDetailsInDb();

    const data = rawData.map((item) => ({
      userName: item.user?.fullName || "N/A",
      email: item.user?.email || "N/A",
      subscriptionPlan: item.plan,
      status: item.status,
      createdAt: item.createdAt.toISOString().split("T")[0],
    }));

    successResponse(res, 200, "User subscription details fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
    );
  }
};

export const userSubscriptionStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const data = await getUserSubscriptionStatusInDb();
    successResponse(res, 200, "User subscription status fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const revenueGrowth = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rawData, collectedData] = await Promise.all([
      getRevenueGrowthInDb(), // contracted / MRR (from subscriptions)
      getCollectedRevenueGrowthInDb(), // collected (from Billing ledger)
    ]);

    const labels = rawData.map((d) => d.label);
    const revenue = rawData.map((d) => d.revenue);
    const collected = collectedData.map((d) => d.revenue);
    // Growth line tracks month-over-month change in collected (actually received) revenue.
    const growth = collected.map((curr, idx) => {
      if (idx === 0) return 0;
      const prev = collected[idx - 1];
      if (prev === 0) return curr > 0 ? 100 : 0;
      return parseFloat((((curr - prev) / prev) * 100).toFixed(2));
    });

    successResponse(res, 200, "Revenue data fetched successfully", {
      success: true,
      error: false,
      message: "Revenue data fetched successfully",
      data: {
        labels,
        revenue,
        collected,
        growth,
      },
    });
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const billingReportDetail = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const data = await getBillingReportDetailInDb();
    successResponse(res, 200, "Billing report detail fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const userReportsBilling = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rawData = await getDashboardSummaryInDb();

    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return parseFloat((((current - previous) / previous) * 100).toFixed(2));
    };

    const data = {
      totalRevenue: {
        value: rawData.revenue.current,
        changePercent: calculateChange(rawData.revenue.current, rawData.revenue.previous),
        comparison: "from last month",
      },
      activeSubscriptions: {
        value: rawData.activeSubscriptions.current,
        changePercent: calculateChange(
          rawData.activeSubscriptions.current,
          rawData.activeSubscriptions.previous,
        ),
        comparison: "from last month",
      },
      newSignups: {
        value: rawData.newSignups.current,
        changePercent: calculateChange(
          rawData.newSignups.current,
          rawData.newSignups.previous,
        ),
        comparison: "from last month",
      },
      totalCallsProcessed: {
        value: rawData.totalCallsProcessed.current,
        changePercent: calculateChange(
          rawData.totalCallsProcessed.current,
          rawData.totalCallsProcessed.previous,
        ),
        comparison: "from last month",
      },
    };

    successResponse(res, 200, "Dashboard summary stats fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const businessOverview = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const data = await getBusinessOverviewInDb();
    successResponse(res, 200, "Business overview fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

export const totalConnections = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getTotalConnectionsInDb();
    successResponse(res, 200, "Total connections fetched successfully", data);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const appointmentsSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getAppointmentsSetInDb();
    successResponse(res, 200, "Appointments set fetched successfully", data);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const avgDaysSinceActive = async (req: Request, res: Response): Promise<void> => {
  try {
    const value = await getAvgDaysSinceActiveInDb();
    successResponse(res, 200, "Avg days since active fetched successfully", { value });
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const planChanges = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getPlanChangesInDb();
    successResponse(res, 200, "Plan changes fetched successfully", data);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const revenuePlans = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const data = await getRevenuePlansInDb();
    successResponse(res, 200, "Revenue plans fetched successfully", data);
  } catch (error: any) {
    errorResponse(
      res,
      error?.message || "Internal server error",
      error?.statusCode || 500,
    );
  }
};

