// supabase/functions/_tournament/scheduling-heuristics.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  findScheduleConflict,
  formatInTimezone,
  generateIcsEvent,
  windowsOverlap,
  wrapIcsCalendar,
} from "./scheduling-heuristics.ts";

Deno.test("windowsOverlap: overlapping windows are detected", () => {
  const a = {
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-02T00:00:00Z",
  };
  const b = {
    startsAt: "2026-01-01T12:00:00Z",
    endsAt: "2026-01-03T00:00:00Z",
  };
  assertEquals(windowsOverlap(a, b), true);
});

Deno.test("windowsOverlap: non-overlapping windows are not a conflict", () => {
  const a = {
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-02T00:00:00Z",
  };
  const b = {
    startsAt: "2026-01-03T00:00:00Z",
    endsAt: "2026-01-04T00:00:00Z",
  };
  assertEquals(windowsOverlap(a, b), false);
});

Deno.test("windowsOverlap: touching endpoints are not a conflict", () => {
  const a = {
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-02T00:00:00Z",
  };
  const b = {
    startsAt: "2026-01-02T00:00:00Z",
    endsAt: "2026-01-03T00:00:00Z",
  };
  assertEquals(windowsOverlap(a, b), false);
});

Deno.test("windowsOverlap is symmetric", () => {
  const a = {
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-02T00:00:00Z",
  };
  const b = {
    startsAt: "2026-01-01T12:00:00Z",
    endsAt: "2026-01-03T00:00:00Z",
  };
  assertEquals(windowsOverlap(a, b), windowsOverlap(b, a));
});

Deno.test("findScheduleConflict: returns the first conflicting window", () => {
  const candidate = {
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-02T00:00:00Z",
  };
  const existing = [
    { startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-02T00:00:00Z" },
    { startsAt: "2026-01-01T12:00:00Z", endsAt: "2026-01-03T00:00:00Z" },
  ];
  const conflict = findScheduleConflict(candidate, existing);
  assertEquals(conflict, existing[1]);
});

Deno.test("findScheduleConflict: returns null when nothing overlaps", () => {
  const candidate = {
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-02T00:00:00Z",
  };
  const existing = [
    { startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-02T00:00:00Z" },
  ];
  assertEquals(findScheduleConflict(candidate, existing), null);
});

Deno.test("formatInTimezone: formats without throwing for a valid IANA zone", () => {
  const formatted = formatInTimezone(
    "2026-06-15T18:00:00Z",
    "America/New_York",
  );
  assertEquals(typeof formatted, "string");
  assertEquals(formatted.length > 0, true);
});

Deno.test("formatInTimezone: falls back to UTC for an invalid timezone rather than throwing", () => {
  const formatted = formatInTimezone("2026-06-15T18:00:00Z", "Not/A_Real_Zone");
  assertEquals(typeof formatted, "string");
});

Deno.test("formatInTimezone: falls back to UTC when timezoneName is null", () => {
  const formatted = formatInTimezone("2026-06-15T18:00:00Z", null);
  assertEquals(typeof formatted, "string");
});

Deno.test("generateIcsEvent produces a valid-shaped VEVENT block", () => {
  const event = generateIcsEvent({
    uid: "abc-123",
    summary: "Test Tournament",
    description: "A test",
    startsAt: "2026-06-15T18:00:00Z",
    endsAt: "2026-06-15T20:00:00Z",
  });
  assertStringIncludes(event, "BEGIN:VEVENT");
  assertStringIncludes(event, "END:VEVENT");
  assertStringIncludes(event, "UID:abc-123");
  assertStringIncludes(event, "SUMMARY:Test Tournament");
});

Deno.test("wrapIcsCalendar wraps events in a valid VCALENDAR envelope", () => {
  const event = generateIcsEvent({
    uid: "abc-123",
    summary: "Test",
    description: "Test",
    startsAt: "2026-06-15T18:00:00Z",
    endsAt: "2026-06-15T20:00:00Z",
  });
  const calendar = wrapIcsCalendar([event]);
  assertStringIncludes(calendar, "BEGIN:VCALENDAR");
  assertStringIncludes(calendar, "VERSION:2.0");
  assertStringIncludes(calendar, "END:VCALENDAR");
  assertStringIncludes(calendar, "BEGIN:VEVENT");
});
