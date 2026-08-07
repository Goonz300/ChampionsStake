// supabase/functions/_tournament/scheduling-heuristics.ts
//
// Phase 8 (TOURNAMENT-010): pure scheduling math, extracted for unit
// testing, same convention as every other *-heuristics.ts module.

export interface TimeWindow {
  startsAt: string; // ISO 8601
  endsAt: string;
}

/** Standard half-open interval overlap check: two windows conflict if one
 * starts before the other ends, in both directions. Touching endpoints
 * (one ends exactly when the other starts) are NOT a conflict. */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Checks a candidate window against every existing window, returning the
 * first conflict found (or null). Used for "an organizer can't run two
 * overlapping tournaments for the same game" conflict detection. */
export function findScheduleConflict(
  candidate: TimeWindow,
  existing: TimeWindow[],
): TimeWindow | null {
  return existing.find((w) => windowsOverlap(candidate, w)) ?? null;
}

/**
 * Timezone-aware display formatting -- Deno's Intl.DateTimeFormat has
 * full ICU timezone data built in, no external library needed. Falls
 * back to UTC if timezoneName is null/invalid rather than throwing (a
 * missing timezone preference is a real, expected state -- migration
 * 0067's own column comment: "Null = no preference set").
 */
export function formatInTimezone(
  isoTimestamp: string,
  timezoneName: string | null,
): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezoneName ?? "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(isoTimestamp));
  } catch {
    // An invalid/unrecognized IANA timezone name -- fail open to UTC
    // rather than throwing and breaking the whole response.
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(isoTimestamp));
  }
}

function toIcsDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().replace(/[-:]/g, "").split(
    ".",
  )[0] + "Z";
}

/**
 * "Calendar integration layer": a single VEVENT block, iCalendar (RFC
 * 5545) format -- a plain text format, no external calendar-provider API
 * needed. A caller wraps one or more of these in a VCALENDAR envelope.
 */
export function generateIcsEvent(input: {
  uid: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  url?: string;
}): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(input.startsAt)}`,
    `DTEND:${toIcsDate(input.endsAt)}`,
    `SUMMARY:${input.summary}`,
    `DESCRIPTION:${input.description}`,
  ];
  if (input.url) lines.push(`URL:${input.url}`);
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function wrapIcsCalendar(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ChampionsStake//Tournament Schedule//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}
