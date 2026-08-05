// supabase/functions/_moderator/types.ts

export type DisputeStatus =
  | "open"
  | "under_review"
  | "resolved"
  | "appealed"
  | "closed";
export type DisputePriority = "low" | "normal" | "high" | "urgent";
export type DisputeResolution =
  | "winner_confirmed"
  | "opponent_confirmed"
  | "split"
  | "voided";

export interface Dispute {
  id: string;
  challengeId: string;
  openedBy: string;
  reason: string;
  status: DisputeStatus;
  priority: DisputePriority;
  assignedModeratorId: string | null;
  resolution: DisputeResolution | null;
  resolutionRationale: string | null;
  evidenceDeadlineAt: string;
  decidedAt: string | null;
  appealFiledAt: string | null;
  appealDeadlineAt: string | null;
  appealDecidedAt: string | null;
  appealDecidedBy: string | null;
}
