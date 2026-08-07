// supabase/functions/_tournament/scheduling.ts
//
// Phase 8 (TOURNAMENT-010): Tournament Scheduling. Repository audit found
// migration 0048 explicitly deferred timestamp-driven lifecycle
// transitions ("check-in-timeout and round-timeout are NOT on fixed
// cron") -- registration/check-in never opened or closed automatically
// at their configured timestamps; every transition needed a manual
// Edge Function call. This module's sweep functions are what was
// deferred, built on the EXISTING publishTournament/closeRegistration/
// openCheckIn (workflow.ts) -- reused directly, never reimplemented.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  closeRegistration,
  openCheckIn,
  publishTournament,
} from "./workflow.ts";
import { getTournamentOrThrow } from "./repository.ts";
import {
  findScheduleConflict,
  generateIcsEvent,
  type TimeWindow,
  wrapIcsCalendar,
} from "./scheduling-heuristics.ts";

/**
 * Conflict detection: an organizer can't usefully run two overlapping
 * tournaments for the same game -- both would compete for the same
 * player pool at the same time. Scoped to the SAME organizer + game (a
 * platform-wide "only one tournament running at a time" rule would be
 * absurd at scale; this is specifically about one organizer's own
 * capacity to run concurrent events well).
 */
export async function checkOrganizerScheduleConflict(
  organizerId: string,
  gameId: string,
  candidateWindow: TimeWindow,
  excludeTournamentId?: string,
): Promise<TimeWindow | null> {
  // Listed positively (non-terminal statuses) rather than via a NOT-IN
  // filter -- this codebase has no established precedent for
  // .not(col, "in", "(...)")'s string-literal-array syntax, and an
  // explicit .in() list is a pattern already used and verified throughout
  // this codebase.
  const NON_TERMINAL_STATUSES = [
    "draft",
    "published",
    "registration",
    "registration_closed",
    "check_in",
    "bracket_generated",
    "round_active",
    "in_progress",
    "round_complete",
    "prize_distribution",
  ];

  const supabase = getServiceRoleClient();
  let query = supabase
    .from("tournaments")
    .select("registration_opens_at, starts_at")
    .eq("created_by", organizerId)
    .eq("game_id", gameId)
    .in("status", NON_TERMINAL_STATUSES)
    .not("registration_opens_at", "is", null)
    .not("starts_at", "is", null);
  if (excludeTournamentId) query = query.neq("id", excludeTournamentId);

  const { data } = await query;
  const existingWindows: TimeWindow[] = (data ?? [])
    .filter((t) => t.registration_opens_at && t.starts_at)
    .map((t) => ({
      startsAt: t.registration_opens_at as string,
      endsAt: t.starts_at as string,
    }));

  return findScheduleConflict(candidateWindow, existingWindows);
}

/** Automatic scheduling: advances a tournament through registration_opens_at
 * -> registration_closes_at -> check_in_opens_at without a human clicking
 * through each step, the gap migration 0048 documented and deferred. */
export async function sweepAutomaticLifecycleTransitions(): Promise<{
  published: number;
  registrationClosed: number;
  checkInOpened: number;
}> {
  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();
  let published = 0;
  let registrationClosed = 0;
  let checkInOpened = 0;

  const { data: toPublish } = await supabase
    .from("tournaments")
    .select("id")
    .eq("status", "draft")
    .not("registration_opens_at", "is", null)
    .lte("registration_opens_at", now);
  for (const t of toPublish ?? []) {
    try {
      await publishTournament(t.id);
      published += 1;
    } catch {
      continue; // a concurrent manual publish, or a genuinely invalid transition -- skip, don't abort the sweep
    }
  }

  const { data: toClose } = await supabase
    .from("tournaments")
    .select("id")
    .eq("status", "registration")
    .not("registration_closes_at", "is", null)
    .lte("registration_closes_at", now);
  for (const t of toClose ?? []) {
    try {
      await closeRegistration(t.id);
      registrationClosed += 1;
    } catch {
      continue;
    }
  }

  const { data: toCheckIn } = await supabase
    .from("tournaments")
    .select("id")
    .eq("status", "registration_closed")
    .not("check_in_opens_at", "is", null)
    .lte("check_in_opens_at", now);
  for (const t of toCheckIn ?? []) {
    try {
      await openCheckIn(t.id);
      checkInOpened += 1;
    } catch {
      continue;
    }
  }

  return { published, registrationClosed, checkInOpened };
}

const MIN_PARTICIPANTS_FOR_START = 2;
const RESCHEDULE_DELAY_HOURS = 24;

/**
 * Automatic rescheduling: if a tournament reaches its scheduled start with
 * fewer than MIN_PARTICIPANTS_FOR_START checked-in registrants, push the
 * start (and check-in window) back by RESCHEDULE_DELAY_HOURS rather than
 * immediately cancelling -- gives an under-filled tournament one more
 * chance rather than wasting registrants' already-locked entry fees on an
 * outright cancellation. Cancellation (existing cancelTournament in
 * workflow.ts) remains the caller's decision if a reschedule isn't
 * wanted -- this function does not force it.
 */
export async function autoRescheduleIfUnderfilled(
  tournamentId: string,
): Promise<{ rescheduled: boolean; newStartsAt?: string }> {
  const supabase = getServiceRoleClient();
  const tournament = await getTournamentOrThrow(tournamentId);
  if (tournament.status !== "check_in") {
    return { rescheduled: false };
  }

  const { count: checkedInCount } = await supabase
    .from("tournament_registrations")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .not("checked_in_at", "is", null);

  if ((checkedInCount ?? 0) >= MIN_PARTICIPANTS_FOR_START) {
    return { rescheduled: false };
  }

  const { data: current } = await supabase
    .from("tournaments")
    .select("starts_at, check_in_opens_at")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!current?.starts_at) return { rescheduled: false };

  const newStartsAt = new Date(
    new Date(current.starts_at as string).getTime() +
      RESCHEDULE_DELAY_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const newCheckInOpensAt = current.check_in_opens_at
    ? new Date(
      new Date(current.check_in_opens_at as string).getTime() +
        RESCHEDULE_DELAY_HOURS * 60 * 60 * 1000,
    ).toISOString()
    : null;

  const { error } = await supabase
    .from("tournaments")
    .update({
      starts_at: newStartsAt,
      check_in_opens_at: newCheckInOpensAt,
      status: "registration_closed", // reopens the check-in step for the new window
    })
    .eq("id", tournamentId)
    .eq("status", "check_in"); // atomic-claim guard against a concurrent manual action
  if (error) {
    throw new Error(`Failed to reschedule tournament: ${error.message}`);
  }

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "TournamentAutoRescheduled",
    category: "tournament",
    targetTable: "tournaments",
    targetId: tournamentId,
    metadata: { checkedInCount: checkedInCount ?? 0, newStartsAt },
  });
  await emit({
    type: "TournamentStarted",
    payload: { tournamentId, event: "AutoRescheduled", newStartsAt },
    emittedBy: "tournament-scheduling",
  });

  return { rescheduled: true, newStartsAt };
}

const REMINDER_WINDOW_HOURS = 24;

/** Reminder generation: reuses the EXISTING notification pipeline
 * (Phase 4's emit()/EVENT_RULES/processUnhandledEvents) via a new event
 * type, not a second notification mechanism. Idempotency: checks
 * domain_events for a prior TournamentReminderDue for this tournament
 * rather than a new tracking column. */
export async function sweepTournamentReminders(): Promise<
  { remindersSent: number }
> {
  const supabase = getServiceRoleClient();
  const windowEnd = new Date(
    Date.now() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000,
  )
    .toISOString();
  const now = new Date().toISOString();

  const { data: upcoming } = await supabase
    .from("tournaments")
    .select("id")
    .in("status", ["registration", "registration_closed", "check_in"])
    .not("starts_at", "is", null)
    .gt("starts_at", now)
    .lte("starts_at", windowEnd);

  // Single batched idempotency check instead of one domain_events query per
  // tournament (performance review finding). A prior reminder for any
  // currently-upcoming tournament can only have been emitted within the
  // last REMINDER_WINDOW_HOURS: once a tournament's starts_at passes (or
  // its status advances past check_in), it drops out of the `upcoming`
  // filter above and is never reconsidered, so this lookback fully covers
  // every tournament this sweep tick could otherwise re-remind.
  const lookback = new Date(
    Date.now() - REMINDER_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data: recentReminders } = await supabase
    .from("domain_events")
    .select("payload")
    .eq("event_type", "TournamentReminderDue")
    .gte("created_at", lookback);
  const alreadyReminded = new Set(
    (recentReminders ?? [])
      .map((e) => (e.payload as Record<string, unknown> | null)?.tournamentId)
      .filter((id): id is string => typeof id === "string"),
  );

  let remindersSent = 0;
  for (const t of upcoming ?? []) {
    if (alreadyReminded.has(t.id)) continue;

    await emit({
      type: "TournamentReminderDue",
      payload: { tournamentId: t.id },
      emittedBy: "tournament-scheduling",
    });
    remindersSent += 1;
  }

  return { remindersSent };
}

export async function getTournamentIcsFeed(
  tournamentId: string,
): Promise<string> {
  const tournament = await getTournamentOrThrow(tournamentId);
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("tournaments")
    .select("name, starts_at, registration_closes_at")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!data?.starts_at) {
    throw new ValidationError(
      "This tournament has no scheduled start time yet.",
    );
  }

  const startsAt = data.starts_at as string;
  const endsAt = new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000)
    .toISOString(); // 2-hour placeholder duration -- actual match count/length isn't known ahead of time

  const event = generateIcsEvent({
    uid: `tournament-${tournament.id}@championsstake`,
    summary: `${data.name} (ChampionsStake)`,
    description: `Tournament: ${data.name}`,
    startsAt,
    endsAt,
  });

  return wrapIcsCalendar([event]);
}

/** "Scheduling analytics": how often tournaments actually start close to
 * their originally scheduled time vs get auto-rescheduled -- reuses the
 * TournamentAutoRescheduled audit trail rather than new tracking. */
export async function getSchedulingAdherence(
  days = 30,
): Promise<
  {
    tournamentsScheduled: number;
    rescheduledCount: number;
    adherenceRate: number;
  }
> {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { count: tournamentsScheduled } = await supabase
    .from("tournaments")
    .select("id", { count: "exact", head: true })
    .not("starts_at", "is", null)
    .gte("created_at", since);

  const { count: rescheduledCount } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "TournamentAutoRescheduled")
    .gte("created_at", since);

  const total = tournamentsScheduled ?? 0;
  return {
    tournamentsScheduled: total,
    rescheduledCount: rescheduledCount ?? 0,
    adherenceRate: total > 0 ? 1 - (rescheduledCount ?? 0) / total : 1,
  };
}
