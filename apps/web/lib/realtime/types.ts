/**
 * Row shapes for tables streamed via Supabase Realtime's Postgres Changes
 * (migration 0053/0077's supabase_realtime publication). Deliberately
 * defined here rather than hand-extending lib/supabase/types.ts's
 * Database type -- that file's own header comment scopes it to "only the
 * tables the Authentication phase touches" and says to regenerate rather
 * than hand-extend for other phases' tables. These are just enough of
 * each row's shape for the realtime hooks to consume; not a claim of
 * completeness the way a generated type would be.
 */

export type PresenceStatus = "online" | "offline" | "away" | "in_match" | "ready";

export interface PresenceRow {
  user_id: string;
  status: PresenceStatus;
  last_seen_at: string;
  current_challenge_id: string | null;
  current_tournament_id: string | null;
}

export interface ChatMessageRow {
  id: string;
  challenge_id: string;
  sender_id: string | null;
  type: "text" | "image" | "video" | "voice" | "system";
  content: string | null;
  media_url: string | null;
  seen_by: string[];
  edited_at: string | null;
  deleted_at: string | null;
  original_content: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  category: string;
  payload: Record<string, unknown>;
  status: "unread" | "read";
  created_at: string;
  read_at: string | null;
}

export interface ChallengeRow {
  id: string;
  status: string;
  creator_id: string;
  opponent_id: string | null;
  stake_cents: number;
  updated_at: string;
}

export interface WalletRow {
  id: string;
  user_id: string;
  status: "active" | "frozen";
  currency: string;
  available_cents: number;
  escrowed_cents: number;
  updated_at: string;
}

export interface TournamentMatchRow {
  id: string;
  round_id: string;
  challenge_id: string | null;
  status: string;
  updated_at: string;
}

export interface TournamentRoundRow {
  id: string;
  tournament_id: string;
  round_number: number;
  status: string;
  updated_at: string;
}

export interface TypingBroadcastPayload {
  userId: string;
  challengeId: string;
  timestamp: string;
}
