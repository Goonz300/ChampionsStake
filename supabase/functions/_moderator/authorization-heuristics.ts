// supabase/functions/_moderator/authorization-heuristics.ts
//
// Pure dispute-assignment authorization logic, extracted out of cases.ts
// (Phase 8.5 hostile-review fix) so it's unit-testable without a live
// database -- same convention as every other *-heuristics.ts file in this
// codebase (elo.ts, fraud-heuristics.ts, reputation-heuristics.ts, etc.).

/**
 * A moderator may act on a dispute if they're an administrator, or if the
 * dispute is unassigned, or if they're the assigned moderator. Any other
 * active moderator is denied -- this is the single-owner-review invariant
 * _moderator/queue.ts's claimDispute/assignDispute already establish
 * ("already assigned to another moderator"), which this function is what
 * actually enforces on every subsequent read/action for that dispute.
 */
export function isModeratorAllowedOnDispute(
  assignedModeratorId: string | null,
  moderatorId: string,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (assignedModeratorId && assignedModeratorId !== moderatorId) {
    return false;
  }
  return true;
}
