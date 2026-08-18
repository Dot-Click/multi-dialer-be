/**
 * Logging streak.
 *
 * OBSERVED BEHAVIOUR: on 2026-07-30 the Saleslytics dashboard showed
 * "CURRENT STREAK 1 days — Last logged: Jun 30". A month had passed with no
 * activity, yet the streak still read 1. So their counter measures the run
 * ending at the LAST LOGGED DATE and does not decay.
 *
 * We reproduce that number (`length`) but also return `isActive`, so the UI can
 * grey out a stale streak instead of implying the agent is still on one. That
 * is a deliberate improvement, not an accidental divergence.
 */

export interface StreakOptions {
  /**
   * Treat Fri -> Mon as consecutive by ignoring weekends. Correct for
   * prospecting, where nobody expects Saturday dials. Default: true.
   */
  weekdaysOnly?: boolean;
  /**
   * How many days may pass before `isActive` goes false. 1 means "logged today
   * or yesterday still counts". Default: 1.
   */
  graceDays?: number;
}

export interface StreakResult {
  /** Consecutive logged days ending at `lastLogged`. 0 when nothing logged. */
  length: number;
  /** Most recent logged date, ISO, or null. */
  lastLogged: string | null;
  /** Whether the run reaches close enough to today to still be "live". */
  isActive: boolean;
}

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.parse(iso + 'T00:00:00Z');
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isWeekend(ms: number): boolean {
  const dow = new Date(ms).getUTCDay(); // 0 Sun .. 6 Sat
  return dow === 0 || dow === 6;
}

/** Step back one counted day, skipping weekends when requested. */
function previousCountedDay(ms: number, weekdaysOnly: boolean): number {
  let cursor = ms - DAY_MS;
  if (weekdaysOnly) {
    while (isWeekend(cursor)) cursor -= DAY_MS;
  }
  return cursor;
}

/**
 * @param loggedDates ISO dates that have at least one session. Duplicates and
 *                    ordering do not matter.
 * @param todayIso    Today, ISO. Used only to decide `isActive`.
 */
export function computeStreak(
  loggedDates: readonly string[],
  todayIso: string,
  options: StreakOptions = {},
): StreakResult {
  const weekdaysOnly = options.weekdaysOnly ?? true;
  const graceDays = options.graceDays ?? 1;

  const set = new Set<string>();
  for (const d of loggedDates) {
    if (typeof d === 'string' && d.length >= 10) set.add(d.slice(0, 10));
  }
  if (set.size === 0) return { length: 0, lastLogged: null, isActive: false };

  const sorted = [...set].sort();
  const lastLogged = sorted[sorted.length - 1] as string;

  let cursor = toUtc(lastLogged);
  if (!Number.isFinite(cursor)) {
    return { length: 0, lastLogged: null, isActive: false };
  }

  let length = 0;
  // Walk backwards while each counted day has a log.
  // Bounded at 3660 iterations (~10 working years) so malformed data can't hang.
  for (let guard = 0; guard < 3660; guard += 1) {
    if (!set.has(toIso(cursor))) break;
    length += 1;
    cursor = previousCountedDay(cursor, weekdaysOnly);
  }

  const today = toUtc(todayIso);
  let isActive = false;
  if (Number.isFinite(today)) {
    const gapDays = Math.round((today - toUtc(lastLogged)) / DAY_MS);
    isActive = gapDays <= graceDays;
  }

  return { length, lastLogged, isActive };
}

/**
 * Weekday coverage over a trailing window — the dot strip on the dashboard.
 * Weekends are reported but excluded from `weekdays` / `hits`.
 */
export function coverageWindow(
  loggedDates: readonly string[],
  todayIso: string,
  windowDays = 28,
): { days: Array<{ date: string; logged: boolean; weekend: boolean }>; hits: number; weekdays: number } {
  const set = new Set(loggedDates.map((d) => d.slice(0, 10)));
  const today = toUtc(todayIso);
  const days: Array<{ date: string; logged: boolean; weekend: boolean }> = [];
  let hits = 0;
  let weekdays = 0;

  if (!Number.isFinite(today)) return { days, hits, weekdays };

  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const ms = today - i * DAY_MS;
    const date = toIso(ms);
    const weekend = isWeekend(ms);
    const logged = set.has(date);
    if (!weekend) {
      weekdays += 1;
      if (logged) hits += 1;
    }
    days.push({ date, logged, weekend });
  }
  return { days, hits, weekdays };
}
