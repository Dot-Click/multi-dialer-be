/**
 * Timezone-aware day-boundary helpers. The project has no date/timezone
 * library installed (moment/date-fns/luxon are frontend-only), so these use
 * only the native Intl API — no new dependency needed.
 */

/**
 * How far the given zone is from UTC at a specific instant, in milliseconds.
 *
 * Read the wall clock the zone shows at that instant, re-tag those numbers as
 * if they were UTC, and the difference from the real instant is the offset.
 * Derived from Intl rather than a table, so DST is handled by definition.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);

  // formatToParts renders midnight as "24" in some locales — normalize.
  const hour = parts.hour === "24" ? "0" : parts.hour;

  const wallClockAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return wallClockAsUTC - at.getTime();
}

/**
 * Returns the UTC instant corresponding to local midnight "today" in the
 * given IANA timezone. Handles DST automatically (e.g. CST vs CDT) since it
 * reads the actual offset Intl reports for "now", not a fixed UTC offset.
 */
export function startOfTodayInTimezone(timeZone: string): Date {
  const now = new Date();
  const offsetMs = zoneOffsetMs(now, timeZone);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month, day] = parts.split("-").map(Number);

  // Local midnight, tagged as UTC, then shifted back by the same offset to get
  // the true UTC instant of that local midnight.
  const localMidnightAsUTC = Date.UTC(year, month - 1, day, 0, 0, 0);

  return new Date(localMidnightAsUTC - offsetMs);
}

/**
 * Which calendar day an instant falls on, in the given zone. "YYYY-MM-DD".
 *
 * This is the whole point of the exercise: 2026-08-21T01:30:00Z is the 21st
 * in London and still the evening of the 20th in Chicago. A tracker that
 * buckets by the former tells an agent their evening calls happened tomorrow.
 *
 * en-CA is not decoration — it is the locale that formats as YYYY-MM-DD.
 */
export function isoDayInTimeZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Today's calendar date in the given zone. "YYYY-MM-DD". */
export function todayIsoInTimeZone(timeZone: string): string {
  return isoDayInTimeZone(new Date(), timeZone);
}

/**
 * The UTC instant at which a given local calendar day begins.
 *
 * The offset is resolved twice on purpose. The first pass uses the offset in
 * force at UTC midnight, which is not necessarily the offset in force at LOCAL
 * midnight — on the two days a year a zone changes, those differ, and a single
 * pass lands an hour out. Recomputing against the corrected instant fixes it.
 */
export function startOfDayInTimeZone(isoDay: string, timeZone: string): Date {
  const asIfUTC = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(asIfUTC.getTime())) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${isoDay}"`);
  }

  const firstPass = zoneOffsetMs(asIfUTC, timeZone);
  let instant = new Date(asIfUTC.getTime() - firstPass);

  const secondPass = zoneOffsetMs(instant, timeZone);
  if (secondPass !== firstPass) {
    instant = new Date(asIfUTC.getTime() - secondPass);
  }

  return instant;
}

/**
 * The UTC instant at which the day AFTER the given local day begins — the
 * exclusive upper bound for "everything that happened on this local day".
 */
export function endOfDayExclusiveInTimeZone(isoDay: string, timeZone: string): Date {
  const start = startOfDayInTimeZone(isoDay, timeZone);
  // Step forward by a day and a half, then snap back to that day's local
  // midnight. Adding exactly 24h breaks on DST transitions, where a local day
  // is 23 or 25 hours long.
  const roughlyNextDay = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  return startOfDayInTimeZone(isoDayInTimeZone(roughlyNextDay, timeZone), timeZone);
}
