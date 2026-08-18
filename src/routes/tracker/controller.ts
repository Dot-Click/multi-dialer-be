import { RequestHandler } from "express";
import { ProspectingStage } from "@prisma/client";
import { successResponse, errorResponse } from "@/utils/handler";
import { TrackerService, type DashboardPeriod } from "./service";
import type { BusinessPlanInputs, SessionRow } from "../../domain/prospecting";

const VALID_PERIODS: readonly DashboardPeriod[] = ["this_week", "this_month", "this_year", "all_time"];
const VALID_PLAN_PERIODS = ["yearly", "monthly", "weekly", "daily"] as const;
const VALID_STAGES = Object.values(ProspectingStage);

function currentYear(): number {
  return new Date().getUTCFullYear();
}

export const getPlan: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const year = req.query.year ? Number(req.query.year) : currentYear();
    const data = await TrackerService.getPlan(userId, year);
    successResponse(res, 200, "Plan fetched", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const putPlan: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const year = req.body.planYear ? Number(req.body.planYear) : currentYear();
    const inputs = req.body.inputs as BusinessPlanInputs;
    const data = await TrackerService.putPlan(userId, year, inputs);
    successResponse(res, 200, "Plan saved", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const getPlanTargets: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const year = req.query.year ? Number(req.query.year) : currentYear();
    const period = (req.query.period as string) ?? "yearly";
    if (!VALID_PLAN_PERIODS.includes(period as any)) {
      errorResponse(res, `period must be one of ${VALID_PLAN_PERIODS.join(", ")}`, 400);
      return;
    }
    const targets = await TrackerService.getPlanTargets(userId, year, period as any);
    successResponse(res, 200, "Targets computed", targets);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const getDashboard: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const period = (req.query.period as string) ?? "this_month";
    if (!VALID_PERIODS.includes(period as DashboardPeriod)) {
      errorResponse(res, `period must be one of ${VALID_PERIODS.join(", ")}`, 400);
      return;
    }
    const data = await TrackerService.getDashboard(userId, period as DashboardPeriod);
    successResponse(res, 200, "Dashboard fetched", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const getFunnel: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const { from, to, source } = req.query as { from?: string; to?: string; source?: string };
    if (!from || !to) {
      errorResponse(res, "from and to (ISO dates) are required", 400);
      return;
    }
    const data = await TrackerService.getFunnel(userId, from, to, source);
    successResponse(res, 200, "Funnel fetched", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const getChannels: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      errorResponse(res, "from and to (ISO dates) are required", 400);
      return;
    }
    const data = await TrackerService.getChannels(userId, from, to);
    successResponse(res, 200, "Channels fetched", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const createStageEvent: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const { contactId, stage, occurredOn, gci, source, note } = req.body;
    if (!contactId || !stage || !occurredOn) {
      errorResponse(res, "contactId, stage and occurredOn are required", 400);
      return;
    }
    if (!VALID_STAGES.includes(stage)) {
      errorResponse(res, `stage must be one of ${VALID_STAGES.join(", ")}`, 400);
      return;
    }
    const data = await TrackerService.createStageEvent(userId, { contactId, stage, occurredOn, gci, source, note });
    successResponse(res, 201, "Stage event recorded", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const deleteStageEvent: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const data = await TrackerService.deleteStageEvent(userId, req.params.id);
    successResponse(res, 200, "Stage event deleted", data);
  } catch (error: any) {
    errorResponse(res, error, 404);
  }
};

export const listSessions: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const { from, to } = req.query as { from?: string; to?: string };
    const data = await TrackerService.listSessions(userId, from, to);
    successResponse(res, 200, "Sessions fetched", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const createSession: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const row = req.body as SessionRow;
    if (!row.loggedOn) {
      errorResponse(res, "loggedOn is required", 400);
      return;
    }
    const data = await TrackerService.upsertSession(userId, {
      loggedOn: row.loggedOn,
      source: row.source ?? null,
      hours: row.hours ?? 0,
      contacts: row.contacts ?? 0,
      leads: row.leads ?? 0,
      apptsSet: row.apptsSet ?? 0,
      apptsMet: row.apptsMet ?? 0,
      listingsTaken: row.listingsTaken ?? 0,
      underContract: row.underContract ?? 0,
      closed: row.closed ?? 0,
      gci: row.gci ?? 0,
      notes: row.notes ?? null,
    });
    successResponse(res, 201, "Session saved", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const patchSession: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const data = await TrackerService.patchSession(userId, req.params.id, req.body);
    successResponse(res, 200, "Session updated", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};

export const deleteSession: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const data = await TrackerService.deleteSession(userId, req.params.id);
    successResponse(res, 200, "Session deleted", data);
  } catch (error: any) {
    errorResponse(res, error, 404);
  }
};

export const getLeaderboard: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      errorResponse(res, "from and to (ISO dates) are required", 400);
      return;
    }
    const data = await TrackerService.getLeaderboard(userId, from, to);
    successResponse(res, 200, "Leaderboard fetched", data);
  } catch (error: any) {
    errorResponse(res, error, 400);
  }
};
