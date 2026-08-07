// supabase/functions/_realtime/notifications.ts
//
// This is the piece that CONSUMES EDGE-001's domain_events log and turns
// entries into actual notifications rows (+ Realtime fan-out via the
// `notifications` table already being in the supabase_realtime publication,
// migration 0053). Every prior phase already calls `emit()` to record an
// event — this file's job is exactly one thing: map an event to (a) which
// user(s) should be notified, (b) which category it belongs to, and (c)
// whether their preferences (AUTH-001's user_preferences table) allow it.
// It does NOT reimplement any business logic from those phases — it only
// reads what they already recorded.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { logger } from "../_shared/logger/index.ts";
import type { NotificationCategory } from "./types.ts";
import { enqueueEmailNotification, sendPushNotification } from "./delivery.ts";

interface EventToNotificationRule {
  category: NotificationCategory;
  preferenceKey: string;
  resolveRecipients: (payload: Record<string, unknown>) => Promise<string[]>;
}

const supabase = getServiceRoleClient();

async function challengeParticipantIds(
  challengeId: unknown,
): Promise<string[]> {
  if (typeof challengeId !== "string") return [];
  const { data } = await supabase.from("challenge_participants").select(
    "user_id",
  ).eq("challenge_id", challengeId);
  return (data ?? []).map((r) => r.user_id as string);
}

async function tournamentCreatorId(tournamentId: unknown): Promise<string[]> {
  if (typeof tournamentId !== "string") return [];
  const { data } = await supabase.from("tournaments").select("created_by").eq(
    "id",
    tournamentId,
  ).maybeSingle();
  return data ? [data.created_by as string] : [];
}

/**
 * Phase 4 fix: chat.ts's sendMessage and escrow-transition.ts's
 * acceptChallenge both emit type "NotificationQueued" (a generic "please
 * notify someone" signal, distinguished only by payload.reason), but no
 * EVENT_RULES entry existed for that type at all -- every chat-message and
 * chat-opened notification was silently dropped by processUnhandledEvents'
 * own "no rule -> mark processed, move on" fallback, despite the emit call
 * making it look wired up. For chat_message specifically, the sender is
 * excluded from their own notification.
 */
async function chatNotificationRecipients(
  payload: Record<string, unknown>,
): Promise<string[]> {
  const reason = payload.reason;
  if (reason === "chat_message") {
    const participants = await challengeParticipantIds(payload.challengeId);
    return participants.filter((id) => id !== payload.senderId);
  }
  if (reason === "chat_opened") {
    return challengeParticipantIds(payload.challengeId);
  }
  return [];
}

/**
 * Extensible mapping table -- wiring up a new event type is adding one row
 * here, not touching any other file. Deliberately not exhaustive for every
 * event name listed in this phase's brief (e.g. "Profile Updated" has no
 * natural single recipient beyond the user themself, who already knows);
 * covers the events with a clear, well-defined recipient.
 */
const EVENT_RULES: Record<string, EventToNotificationRule> = {
  ChallengeCreated: {
    category: "challenge",
    preferenceKey: "challenge_updates",
    resolveRecipients: (p) => challengeParticipantIds(p.challengeId),
  },
  ChallengeAccepted: {
    category: "challenge",
    preferenceKey: "challenge_updates",
    resolveRecipients: (p) => challengeParticipantIds(p.challengeId),
  },
  EscrowLocked: {
    category: "escrow",
    preferenceKey: "wallet_updates",
    resolveRecipients: (p) => challengeParticipantIds(p.challengeId),
  },
  FundsReleased: {
    category: "escrow",
    preferenceKey: "wallet_updates",
    resolveRecipients: (p) => challengeParticipantIds(p.challengeId),
  },
  DisputeOpened: {
    category: "moderator",
    preferenceKey: "dispute_updates",
    resolveRecipients: (p) => challengeParticipantIds(p.challengeId),
  },
  TournamentStarted: {
    category: "tournament",
    preferenceKey: "tournament_updates",
    resolveRecipients: (p) => tournamentCreatorId(p.tournamentId),
  },
  TournamentRoundCompleted: {
    category: "tournament",
    preferenceKey: "tournament_updates",
    resolveRecipients: (p) => tournamentCreatorId(p.tournamentId),
  },
  // Phase 4 additions. Deliberately still not exhaustive over every
  // challenge-lifecycle type this phase's event-contract fix introduced
  // (ChallengeReadyStarted/CountdownStarted/MatchStarted/WinnerSubmitted) --
  // those happen while both participants are actively in the match UI,
  // which already gets realtime updates via Postgres Changes on the
  // `challenges` table itself; a duplicate notification for them has no
  // clear value the way "your match finished" or "your match was
  // cancelled" (below) does. No dedicated "chat" notification_category
  // exists (migration 0052's 10 categories), so chat notifications reuse
  // "challenge" -- chat is inherently challenge-scoped, and adding a new
  // enum value for this alone isn't a genuinely required migration.
  ChallengeCompleted: {
    category: "challenge",
    preferenceKey: "challenge_updates",
    resolveRecipients: (p) => challengeParticipantIds(p.challengeId),
  },
  ChallengeCancelled: {
    category: "challenge",
    preferenceKey: "challenge_updates",
    resolveRecipients: (p) => challengeParticipantIds(p.challengeId),
  },
  NotificationQueued: {
    category: "challenge",
    preferenceKey: "chat_messages",
    resolveRecipients: (p) => chatNotificationRecipients(p),
  },
  // Phase 8 (TOURNAMENT-003): Team Platform.
  TeamInvitationSent: {
    category: "team",
    preferenceKey: "social_updates",
    resolveRecipients: (p) =>
      Promise.resolve(
        typeof p.invitedUserId === "string" ? [p.invitedUserId] : [],
      ),
  },
  TeamOwnershipTransferred: {
    category: "team",
    preferenceKey: "social_updates",
    resolveRecipients: (p) =>
      Promise.resolve(
        typeof p.newOwnerId === "string" ? [p.newOwnerId] : [],
      ),
  },
  // Phase 8 (TOURNAMENT-007): Organizer Platform.
  TournamentInvitationSent: {
    category: "tournament",
    preferenceKey: "tournament_updates",
    resolveRecipients: (p) =>
      Promise.resolve(
        typeof p.invitedUserId === "string" ? [p.invitedUserId] : [],
      ),
  },
};

async function isCategoryEnabled(
  userId: string,
  preferenceKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("user_preferences")
    .select("notification_preferences")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return true;
  const prefs = data.notification_preferences as Record<
    string,
    { push?: boolean }
  >;
  return prefs?.[preferenceKey]?.push !== false;
}

/**
 * Phase 4 addition: the email channel has its own preference key
 * (user_preferences' default jsonb already ships a distinct `email`
 * boolean per category, migration 0027) but nothing ever read it --
 * isCategoryEnabled above only ever checked `.push`, and used that single
 * check to gate BOTH the in-app row and (now) the actual push send, since
 * "push" is genuinely what that preference key means. Email needs its own
 * check since a user may want one channel without the other.
 */
async function isEmailChannelEnabled(
  userId: string,
  preferenceKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("user_preferences")
    .select("notification_preferences")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return true;
  const prefs = data.notification_preferences as Record<
    string,
    { email?: boolean }
  >;
  return prefs?.[preferenceKey]?.email !== false;
}

/**
 * Processes unprocessed domain_events (processed_at is null) into
 * notifications rows. Called by the notification-send Edge Function, on a
 * schedule or on-demand -- idempotent (marks each event processed_at
 * immediately after handling so a retry never double-notifies).
 */
export async function processUnhandledEvents(
  limit = 100,
): Promise<{ processed: number; notified: number }> {
  const { data: events, error } = await supabase
    .from("domain_events")
    .select("*")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch unprocessed events: ${error.message}`);
  }

  let notified = 0;

  for (const event of events ?? []) {
    const rule = EVENT_RULES[event.event_type];
    if (!rule) {
      await supabase.from("domain_events").update({
        processed_at: new Date().toISOString(),
      }).eq("id", event.id);
      continue;
    }

    try {
      const recipients = await rule.resolveRecipients(
        event.payload as Record<string, unknown>,
      );
      for (const userId of recipients) {
        if (!(await isCategoryEnabled(userId, rule.preferenceKey))) continue;

        await supabase.from("notifications").insert({
          user_id: userId,
          type: event.event_type,
          category: rule.category,
          payload: event.payload,
        });
        notified += 1;

        // Phase 4: push_tokens/email_queue were fully inert before this --
        // every notification only ever reached the in-app feed. Both are
        // best-effort/fire-and-isolate internally (see delivery.ts) and
        // must never affect the domain_events processing loop's own
        // success/idempotency, so their own errors are swallowed there,
        // not here.
        await sendPushNotification(
          userId,
          event.event_type,
          event.payload as Record<string, unknown>,
        );
        if (await isEmailChannelEnabled(userId, rule.preferenceKey)) {
          await enqueueEmailNotification(
            userId,
            event.event_type,
            event.payload as Record<string, unknown>,
          );
        }
      }
    } catch (err) {
      logger.error("Failed to process domain event into notifications", {
        eventId: event.id,
        eventType: event.event_type,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await supabase.from("domain_events").update({
      processed_at: new Date().toISOString(),
    }).eq("id", event.id);
  }

  return { processed: (events ?? []).length, notified };
}

export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  await supabase
    .from("notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from("notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "unread");
}
