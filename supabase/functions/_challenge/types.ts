// supabase/functions/_challenge/types.ts
//
// Domain types for the Escrow Engine (ESCROW-001). Lives outside _shared
// for the same reason _wallet does — EDGE-001's framework is business-
// logic-free.

export type ChallengeStatus =
  | "draft"
  | "published"
  | "waiting"
  | "accepted"
  | "escrow_pending"
  | "escrow_locked"
  | "ready"
  | "countdown"
  | "live"
  | "winner_submitted"
  | "awaiting_confirmation"
  | "released"
  | "disputed"
  | "moderator_review"
  | "completed"
  | "cancelled"
  | "expired"
  | "archived";

export interface Challenge {
  id: string;
  creatorId: string;
  opponentId: string | null;
  gameId: string;
  stakeCents: number;
  visibility: "public" | "private" | "friends";
  status: ChallengeStatus;
  resultLocked: boolean;
  winnerSubmittedBy: string | null;
  readyDeadlineAt: string | null;
  expiresAt: string | null;
}

export interface EscrowAccount {
  id: string;
  challengeId: string | null;
  tournamentId: string | null;
  status: "locked" | "released" | "refunded" | "voided";
  totalLockedCents: number;
}
