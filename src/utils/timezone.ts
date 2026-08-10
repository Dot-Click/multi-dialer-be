/**
 * Timezone-aware day-boundary helpers. The project has no date/timezone
 * library installed (moment/date-fns/luxon are frontend-only), so these use
 * only the native Intl API — no new dependency needed.
 */

/**
 * Returns the UTC instant corresponding to local midnight "today" in the
 * given IANA timezone. Handles DST automatically (e.g. CST vs CDT) since it
 * reads the actual offset Intl reports for "now", not a fixed UTC offset.
 */
export function startOfTodayInTimezone(timeZone: string): Date {
  const now = new Date();

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
    .formatToParts(now)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);

  // formatToParts renders midnight as "24" in some locales — normalize.
  const hour = parts.hour === "24" ? "0" : parts.hour;

  // Re-tag the timezone's wall-clock reading as if it were UTC, so comparing
  // it against `now` (a true UTC instant) isolates the timezone's offset.
  const wallClockAsUTC = new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(hour),
      Number(parts.minute),
      Number(parts.second),
    ),
  );
  const offsetMs = wallClockAsUTC.getTime() - now.getTime();

  // Local midnight, also re-tagged as UTC, then shifted back by the same
  // offset to get the true UTC instant of that local midnight.
  const localMidnightAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    0,
    0,
    0,
  );

  return new Date(localMidnightAsUTC - offsetMs);
}
