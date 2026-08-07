// supabase/functions/_league/league-heuristics.ts
//
// Pure logic for the League Platform (Phase 8 TOURNAMENT-004), extracted
// for unit testing without a live database, same convention as every
// other *-heuristics.ts module.

export interface DivisionStanding {
  participantId: string; // user_id or team_id
  tier: number;
  points: number;
}

export interface PromotionRelegationMove {
  participantId: string;
  fromTier: number;
  toTier: number;
  reason: "promotion" | "relegation";
}

/**
 * Standard promotion/relegation: within each division (tier), the top
 * `promoteCount` participants move up one tier (skipped for tier 1 --
 * already the top), and the bottom `relegateCount` move down one tier
 * (skipped for the lowest tier present -- already the bottom). Ties at the
 * promotion/relegation boundary are broken by participantId ordering
 * (stable, deterministic) -- a real tiebreak (head-to-head, goal
 * difference) is a business-policy decision this function doesn't invent,
 * same discipline as bracket.ts's round-robin/Swiss tiebreak scoping.
 */
export function computePromotionRelegation(
  standings: DivisionStanding[],
  promoteCount: number,
  relegateCount: number,
): PromotionRelegationMove[] {
  const tiers = [...new Set(standings.map((s) => s.tier))].sort((a, b) =>
    a - b
  );
  const minTier = Math.min(...tiers);
  const maxTier = Math.max(...tiers);
  const moves: PromotionRelegationMove[] = [];

  for (const tier of tiers) {
    const inTier = standings
      .filter((s) => s.tier === tier)
      .sort((a, b) =>
        b.points - a.points || a.participantId.localeCompare(b.participantId)
      );

    if (tier > minTier) {
      for (const p of inTier.slice(0, promoteCount)) {
        moves.push({
          participantId: p.participantId,
          fromTier: tier,
          toTier: tier - 1,
          reason: "promotion",
        });
      }
    }

    if (tier < maxTier && relegateCount > 0) {
      // slice(-0) behaves like slice(0) (the WHOLE array) in JS, not an
      // empty slice -- the relegateCount > 0 guard above is required, not
      // redundant, to actually relegate nobody when relegateCount is 0.
      for (const p of inTier.slice(-relegateCount)) {
        // A tier with fewer participants than promoteCount + relegateCount
        // could otherwise double-count the same participant as both
        // promoted and relegated -- explicitly excluded.
        if (!moves.some((m) => m.participantId === p.participantId)) {
          moves.push({
            participantId: p.participantId,
            fromTier: tier,
            toTier: tier + 1,
            reason: "relegation",
          });
        }
      }
    }
  }

  return moves;
}

export interface MatchOutcome {
  won: boolean | null; // null = draw
}

/** Standard 3/1/0 points-per-result -- the most common league scoring
 * convention (football-style); a business could configure a different
 * scheme, but this is a sane, documented default, not an invented rule
 * with no basis. */
export function computeStandingPointsDelta(outcome: MatchOutcome): {
  points: number;
  won: boolean;
  lost: boolean;
  drew: boolean;
} {
  if (outcome.won === null) {
    return { points: 1, won: false, lost: false, drew: true };
  }
  if (outcome.won) return { points: 3, won: true, lost: false, drew: false };
  return { points: 0, won: false, lost: true, drew: false };
}
