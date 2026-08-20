import prisma from "@/lib/prisma";
import { Prisma, ProspectingStage } from "@prisma/client";
import { resolveTenantUserIds } from "../../utils/tenant";
import { getDailyRows } from "./rollup.service";
import {
  aggregateSessions,
  annualTargets,
  assertValidPlan,
  computeActualKpis,
  computeAttainment,
  computeStreak,
  coverageWindow,
  elapsedFraction,
  planForPeriod,
  projectedGci,
  roundTargets,
  stagesFor,
  stepsFor,
  targetsForPeriod,
  type BusinessPlanInputs,
  type PeriodKey,
  type SessionRow,
} from "../../domain/prospecting";

/**
 * Slingvo's own default is Under Contract ON (9 stages) — the client's
 * SALESLYTICS_DEFAULTS in the domain layer intentionally ships with it OFF
 * (8 stages) since that constant exists to prove parity. This is the default
 * a brand-new plan actually starts from.
 */
const DEFAULT_PLAN_INPUTS: BusinessPlanInputs = {
  netIncomeGoal: 180_000,
  avgCommissionRatePct: 2.9,
  avgPricePoint: 400_000,
  profitMarginPct: 70,
  contactsPerHour: 7,
  contactToLeadPct: 10,
  leadToSetPct: 20,
  setToMetPct: 50,
  metToTakenPct: 50,
  takenToClosedPct: 70,
  takenToUnderContractPct: 85,
  underContractToClosedPct: 82.4,
  includeUnderContract: true,
  calendar: { workingWeeksPerYear: 50, workingDaysPerWeek: 5 },
};

const DAY_MS = 86_400_000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type DashboardPeriod = "today" | "this_week" | "this_month" | "this_year" | "all_time";

/** Inclusive [from, to] ISO date range for a dashboard period, plus the
 * matching domain PeriodKey used to scale annual targets down for comparison. */
function resolvePeriodRange(period: DashboardPeriod): { from: string; to: string; periodKey: PeriodKey } {
  const now = new Date();
  const to = todayIso();

  if (period === "today") {
    // Single day. "daily" scales annual targets by the WORKING calendar
    // divisor (weeks x days, typically 250) — not 365, which would quietly
    // understate the daily number by a third.
    return { from: to, to, periodKey: "daily" };
  }
  if (period === "this_week") {
    // ISO week: Monday start.
    const dow = now.getUTCDay(); // 0 Sun .. 6 Sat
    const daysSinceMonday = (dow + 6) % 7;
    const monday = new Date(now.getTime() - daysSinceMonday * DAY_MS);
    return { from: monday.toISOString().slice(0, 10), to, periodKey: "weekly" };
  }
  if (period === "this_month") {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: first.toISOString().slice(0, 10), to, periodKey: "monthly" };
  }
  if (period === "this_year") {
    const first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { from: first.toISOString().slice(0, 10), to, periodKey: "yearly" };
  }
  // all_time — no natural divisor; targets are shown at the yearly scale as
  // the least-misleading reference point (see getDashboard's pace comment).
  return { from: "2000-01-01", to, periodKey: "yearly" };
}

function toBusinessPlanInputs(row: {
  netIncomeGoal: Prisma.Decimal; avgCommissionRatePct: Prisma.Decimal; avgPricePoint: Prisma.Decimal;
  profitMarginPct: Prisma.Decimal; contactsPerHour: Prisma.Decimal; contactToLeadPct: Prisma.Decimal;
  leadToSetPct: Prisma.Decimal; setToMetPct: Prisma.Decimal; metToTakenPct: Prisma.Decimal;
  takenToClosedPct: Prisma.Decimal; takenToUnderContractPct: Prisma.Decimal; underContractToClosedPct: Prisma.Decimal;
  includeUnderContract: boolean; workingWeeksPerYear: number; workingDaysPerWeek: number;
}): BusinessPlanInputs {
  return {
    netIncomeGoal: Number(row.netIncomeGoal),
    avgCommissionRatePct: Number(row.avgCommissionRatePct),
    avgPricePoint: Number(row.avgPricePoint),
    profitMarginPct: Number(row.profitMarginPct),
    contactsPerHour: Number(row.contactsPerHour),
    contactToLeadPct: Number(row.contactToLeadPct),
    leadToSetPct: Number(row.leadToSetPct),
    setToMetPct: Number(row.setToMetPct),
    metToTakenPct: Number(row.metToTakenPct),
    takenToClosedPct: Number(row.takenToClosedPct),
    takenToUnderContractPct: Number(row.takenToUnderContractPct),
    underContractToClosedPct: Number(row.underContractToClosedPct),
    includeUnderContract: row.includeUnderContract,
    calendar: {
      workingWeeksPerYear: row.workingWeeksPerYear,
      workingDaysPerWeek: row.workingDaysPerWeek,
    },
  };
}

export class TrackerService {
  // ── Business plan ───────────────────────────────────────────────────────

  static async getPlan(userId: string, year: number) {
    const row = await prisma.prospectingBusinessPlan.findUnique({
      where: { userId_planYear: { userId, planYear: year } },
    });
    return {
      planYear: year,
      isDefault: !row,
      inputs: row ? toBusinessPlanInputs(row) : DEFAULT_PLAN_INPUTS,
    };
  }

  static async putPlan(userId: string, year: number, inputs: BusinessPlanInputs) {
    // Fail loudly, by field name, before writing anything.
    assertValidPlan(inputs);

    const data = {
      netIncomeGoal: inputs.netIncomeGoal,
      avgCommissionRatePct: inputs.avgCommissionRatePct,
      avgPricePoint: inputs.avgPricePoint,
      profitMarginPct: inputs.profitMarginPct,
      contactsPerHour: inputs.contactsPerHour,
      contactToLeadPct: inputs.contactToLeadPct,
      leadToSetPct: inputs.leadToSetPct,
      setToMetPct: inputs.setToMetPct,
      metToTakenPct: inputs.metToTakenPct,
      takenToClosedPct: inputs.takenToClosedPct,
      takenToUnderContractPct: inputs.takenToUnderContractPct,
      underContractToClosedPct: inputs.underContractToClosedPct,
      includeUnderContract: inputs.includeUnderContract,
      workingWeeksPerYear: inputs.calendar.workingWeeksPerYear,
      workingDaysPerWeek: inputs.calendar.workingDaysPerWeek,
    };

    const row = await prisma.prospectingBusinessPlan.upsert({
      where: { userId_planYear: { userId, planYear: year } },
      create: { userId, planYear: year, ...data },
      update: data,
    });
    return { planYear: year, isDefault: false, inputs: toBusinessPlanInputs(row) };
  }

  /**
   * Targets are computed live, every call — never stored. This is the
   * specific behaviour BUILD_SPEC.md calls out as the fix for Saleslytics'
   * own bug (their cached `user_goals` snapshot has two fields stuck at 0).
   */
  static async getPlanTargets(userId: string, year: number, period: PeriodKey) {
    const { inputs } = await this.getPlan(userId, year);
    return roundTargets(planForPeriod(inputs, period));
  }

  // ── Dashboard ────────────────────────────────────────────────────────────

  static async getDashboard(userId: string, period: DashboardPeriod) {
    const { from, to, periodKey } = resolvePeriodRange(period);
    const year = new Date(to).getUTCFullYear();

    const [rows, { inputs: plan }] = await Promise.all([
      getDailyRows(userId, from, to),
      this.getPlan(userId, year),
    ]);

    const totals = aggregateSessions(rows);
    const kpis = computeActualKpis(totals);
    const stages = stagesFor(plan.includeUnderContract);

    const targets = roundTargets(targetsForPeriod(annualTargets(plan), periodKey, plan.calendar));
    const attainment = computeAttainment(totals, targets, stages);

    const loggedDates = [...new Set(rows.filter((r) => r.hours > 0 || r.contacts > 0).map((r) => r.loggedOn))];
    const streak = computeStreak(loggedDates, todayIso());
    const coverage = coverageWindow(loggedDates, todayIso());

    const elapsed = elapsedFraction(from, to, todayIso());
    const projected = projectedGci(totals.gci, elapsed);

    return {
      period: { key: period, from, to },
      totals,
      kpis,
      targets,
      attainment,
      streak,
      coverage,
      pace: {
        gciToDate: totals.gci,
        gciTarget: targets.gciNeeded,
        elapsedFraction: elapsed,
        projectedGci: projected,
        // null when there's nothing to compare against (elapsed === null, i.e.
        // no time has passed yet in the period) rather than a misleading 0/0.
        onPace:
          projected === null || targets.gciNeeded === 0
            ? null
            : projected >= targets.gciNeeded,
      },
    };
  }

  // ── Funnel ───────────────────────────────────────────────────────────────

  static async getFunnel(userId: string, from: string, to: string, source?: string) {
    const rows = await getDailyRows(userId, from, to);
    const filtered = source ? rows.filter((r) => r.source === source) : rows;
    const totals = aggregateSessions(filtered);
    const kpis = computeActualKpis(totals);

    const { inputs: plan } = await this.getPlan(userId, new Date(to).getUTCFullYear());
    const stages = stagesFor(plan.includeUnderContract);
    const steps = stepsFor(plan.includeUnderContract);

    return {
      range: { from, to, source: source ?? null },
      stages: stages.map((id) => ({ id, value: totals[stageToTotalsKey(id)] })),
      steps: steps.map((s) => ({ ...s, value: kpis[s.kpiKey] })),
      // Headline composite: Lead disposition -> Listing Taken disposition,
      // spanning appointment set and met. Answers "how many of my leads
      // actually become listings", which no single adjacent step shows.
      //
      // Cumulative (total / total), unclamped, and null rather than 0 when
      // there are no leads — a rate with no denominator is not computable,
      // which is a different statement from "you converted none of them".
      leadToTaken:
        totals.leads > 0 ? (totals.listingsTaken / totals.leads) * 100 : null,
    };
  }

  // ── Channels ─────────────────────────────────────────────────────────────

  static async getChannels(userId: string, from: string, to: string) {
    const rows = await getDailyRows(userId, from, to);
    const bySource = new Map<string, SessionRow[]>();
    for (const r of rows) {
      const key = r.source ?? "Untagged";
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(r);
    }

    const channels = [...bySource.entries()].map(([source, sourceRows]) => {
      const totals = aggregateSessions(sourceRows);
      const kpis = computeActualKpis(totals);
      return { source, totals, kpis };
    });

    // Ranked by GCI/hour, nulls (no hours logged) sorted last — "which
    // activity earns the most per hour" per the client's own view comment.
    channels.sort((a, b) => {
      if (a.kpis.gciPerHour === null) return 1;
      if (b.kpis.gciPerHour === null) return -1;
      return b.kpis.gciPerHour - a.kpis.gciPerHour;
    });

    return { range: { from, to }, channels };
  }

  // ── Stage events (manual, for cases the CRM disposition flow doesn't cover) ─

  static async createStageEvent(userId: string, params: {
    contactId: string; stage: ProspectingStage; occurredOn: string; gci?: number; source?: string | null; note?: string | null;
  }) {
    const contact = await prisma.contact.findFirst({
      where: { id: params.contactId, userId },
      select: { id: true, source: true },
    });
    if (!contact) throw new Error("Contact not found, or does not belong to you");

    return prisma.prospectingStageEvent.upsert({
      where: { contactId_stage: { contactId: params.contactId, stage: params.stage } },
      create: {
        userId,
        contactId: params.contactId,
        stage: params.stage,
        occurredOn: new Date(params.occurredOn),
        gci: params.gci ?? 0,
        source: params.source ?? contact.source ?? null,
        note: params.note ?? null,
      },
      update: {
        occurredOn: new Date(params.occurredOn),
        gci: params.gci ?? 0,
        source: params.source ?? undefined,
        note: params.note ?? undefined,
      },
    });
  }

  static async deleteStageEvent(userId: string, id: string) {
    const existing = await prisma.prospectingStageEvent.findFirst({ where: { id, userId } });
    if (!existing) throw new Error("Stage event not found, or does not belong to you");
    await prisma.prospectingStageEvent.delete({ where: { id } });
    return { success: true };
  }

  // ── Sessions (manual override / historical backfill) ────────────────────

  static async listSessions(userId: string, from?: string, to?: string) {
    return prisma.prospectingSession.findMany({
      where: {
        userId,
        ...(from || to
          ? {
              loggedOn: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { loggedOn: "desc" },
    });
  }

  static async upsertSession(userId: string, row: SessionRow) {
    const data = {
      hours: row.hours,
      contacts: row.contacts,
      leads: row.leads,
      apptsSet: row.apptsSet,
      apptsMet: row.apptsMet,
      listingsTaken: row.listingsTaken,
      underContract: row.underContract,
      closed: row.closed,
      gci: row.gci,
      notes: row.notes ?? null,
      isOverride: true,
    };
    const loggedOn = new Date(row.loggedOn);

    // NOT a Prisma .upsert() against the (userId, loggedOn, source) unique
    // constraint: Postgres treats every NULL `source` as distinct from every
    // other NULL, so a compound-unique lookup can't identify "the" row when
    // source is null — Prisma's generated types correctly refuse to let you
    // try. findFirst + create/update below also happens to be the behaviour
    // we actually want for null-source rows: one manual entry per (user, day)
    // with no channel, not a new row every save.
    const existing = await prisma.prospectingSession.findFirst({
      where: { userId, loggedOn, source: row.source },
    });
    if (existing) {
      return prisma.prospectingSession.update({ where: { id: existing.id }, data });
    }
    return prisma.prospectingSession.create({
      data: { userId, loggedOn, source: row.source, ...data },
    });
  }

  static async patchSession(userId: string, id: string, patch: Partial<SessionRow>) {
    const existing = await prisma.prospectingSession.findFirst({ where: { id, userId } });
    if (!existing) throw new Error("Session not found, or does not belong to you");
    return prisma.prospectingSession.update({
      where: { id },
      data: {
        ...(patch.hours !== undefined ? { hours: patch.hours } : {}),
        ...(patch.contacts !== undefined ? { contacts: patch.contacts } : {}),
        ...(patch.leads !== undefined ? { leads: patch.leads } : {}),
        ...(patch.apptsSet !== undefined ? { apptsSet: patch.apptsSet } : {}),
        ...(patch.apptsMet !== undefined ? { apptsMet: patch.apptsMet } : {}),
        ...(patch.listingsTaken !== undefined ? { listingsTaken: patch.listingsTaken } : {}),
        ...(patch.underContract !== undefined ? { underContract: patch.underContract } : {}),
        ...(patch.closed !== undefined ? { closed: patch.closed } : {}),
        ...(patch.gci !== undefined ? { gci: patch.gci } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
    });
  }

  static async deleteSession(userId: string, id: string) {
    const existing = await prisma.prospectingSession.findFirst({ where: { id, userId } });
    if (!existing) throw new Error("Session not found, or does not belong to you");
    await prisma.prospectingSession.delete({ where: { id } });
    return { success: true };
  }

  // ── Leaderboard — scoped to the agent-seat tenant, opt-in only ──────────

  static async getLeaderboard(userId: string, from: string, to: string) {
    const scopedIds = await resolveTenantUserIds(userId);

    const optedIn = await prisma.user.findMany({
      where: {
        prospectingLeaderboardOptIn: true,
        ...(scopedIds ? { id: { in: scopedIds } } : {}), // null = OWNER, platform-wide
      },
      select: { id: true, fullName: true, email: true },
    });

    const rows = await Promise.all(
      optedIn.map(async (u) => {
        const dailyRows = await getDailyRows(u.id, from, to);
        const totals = aggregateSessions(dailyRows);
        return {
          userId: u.id,
          name: u.fullName ?? u.email,
          contacts: totals.contacts,
          leads: totals.leads,
          closed: totals.closed,
          gci: totals.gci,
        };
      }),
    );

    rows.sort((a, b) => b.gci - a.gci);
    return { range: { from, to }, leaderboard: rows };
  }
}

function stageToTotalsKey(stage: string): "hours" | "contacts" | "leads" | "apptsSet" | "apptsMet" | "listingsTaken" | "underContract" | "closed" | "gci" {
  return stage as any;
}
