// supabase/functions/_tournament/types.ts

export type TournamentStatus =
  | "draft"
  | "published"
  | "registration"
  | "registration_closed"
  | "check_in"
  | "bracket_generated"
  | "round_active"
  | "round_complete"
  | "prize_distribution"
  | "completed"
  | "archived"
  | "cancelled";

export type TournamentFormat = "single_elim" | "double_elim" | "round_robin";

export interface Tournament {
  id: string;
  gameId: string;
  name: string;
  format: TournamentFormat;
  entryFeeCents: number;
  prizePoolCents: number;
  payoutStructure: Record<string, number>;
  status: TournamentStatus;
  createdBy: string;
}

export interface Registration {
  tournamentId: string;
  userId: string;
  seed: number | null;
  checkedInAt: string | null;
  eliminated: boolean;
  forfeited: boolean;
}

export interface BracketMatch {
  roundNumber: number;
  bracketPosition: number;
  playerAId: string | null;
  playerBId: string | null; // null = a bye
}
