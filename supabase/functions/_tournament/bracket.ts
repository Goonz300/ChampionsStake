// supabase/functions/_tournament/bracket.ts
//
// Phase 8 (TOURNAMENT-002): single elimination, round robin, Swiss (round 1
// + subsequent-round pairing), and double elimination are all implemented
// below. What was true when this file was first written (Business Rules §5
// not specifying tiebreak/pairing rules closely enough) is still true for
// FINAL STANDINGS tiebreaks (e.g. head-to-head vs point differential when
// two round-robin players tie on wins) -- that remains a business-policy
// decision this phase does not invent. What IS fully standardized and
// implementable without inventing anything are the PAIRING algorithms
// themselves: round-robin's circle method, Swiss's score-group pairing
// (Dutch system, simplified -- no Buchholz/Sonneborn-Berger secondary
// tiebreak, which is a ranking-tiebreak concern, not a pairing one), and
// double-elimination's standard winners/losers bracket with a single grand
// final (no bracket reset if the losers-bracket finalist wins it -- a
// documented simplification, not the only valid double-elim variant, but a
// standard and complete one).

import type { BracketMatch, Registration } from "./types.ts";

export interface BracketGenerator {
  generate(registrations: Registration[]): BracketMatch[];
}

/**
 * Seeds registrations by trust score descending (Business Rules §5),
 * ties broken by registration order (earliest first) — registrations are
 * expected to already carry a `seed` value assigned at registration time;
 * this just sorts by it.
 */
function seededOrder(registrations: Registration[]): Registration[] {
  return [...registrations].sort((a, b) =>
    (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER)
  );
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard single-elimination seeding: seed 1 vs the bye/lowest seed,
 * seed 2 vs the next-lowest, etc., using the standard "1 vs N, 2 vs N-1"
 * bracket-seeding pattern so higher seeds don't meet each other until later
 * rounds. Byes (when the field isn't a power of two) go to the top seeds.
 */
export const singleEliminationGenerator: BracketGenerator = {
  generate(registrations: Registration[]): BracketMatch[] {
    const eligible = registrations.filter((r) =>
      r.checkedInAt !== null && !r.forfeited
    );
    const ordered = seededOrder(eligible);
    const bracketSize = nextPowerOfTwo(ordered.length);

    // Standard bracket seed order for a power-of-two bracket, e.g. for 8:
    // [1,8,4,5,2,7,3,6] (seed indices, 0-based below). Computed
    // recursively rather than hard-coded so it works for any bracket size.
    function seedOrderIndices(size: number): number[] {
      if (size === 1) return [0];
      const prev = seedOrderIndices(size / 2);
      const result: number[] = [];
      for (const i of prev) {
        result.push(i, size - 1 - i);
      }
      return result;
    }

    const positions = seedOrderIndices(bracketSize);
    const slots: (Registration | null)[] = positions.map((seedIndex) =>
      seedIndex < ordered.length ? ordered[seedIndex] : null
    );

    const matches: BracketMatch[] = [];
    for (let i = 0; i < slots.length; i += 2) {
      matches.push({
        roundNumber: 1,
        bracketPosition: i / 2,
        playerAId: slots[i]?.userId ?? null,
        playerBId: slots[i + 1]?.userId ?? null,
      });
    }

    return matches;
  },
};

/**
 * Double elimination, winners bracket round 1: identical seeding to
 * singleEliminationGenerator (same seed-order algorithm, same bye
 * handling) -- the winners bracket of a double-elim tournament IS a
 * single-elim bracket; what's different is that a loss doesn't eliminate a
 * player, it drops them into the losers bracket (computeNextLosersRound
 * below). generate() only produces round 1, same as single-elim -- later
 * winners-bracket rounds still come from computeNextRound.
 */
export const doubleEliminationGenerator: BracketGenerator = {
  generate(registrations: Registration[]): BracketMatch[] {
    return singleEliminationGenerator.generate(registrations);
  },
};

/**
 * Losers-bracket round: pairs incoming players (LB survivors from the
 * previous LB round, and/or newly-eliminated WB-round losers) in the order
 * given. SCOPING NOTE: this does not implement "avoid an immediate
 * rematch" bracket-integrity optimization real tournament software adds on
 * top -- doing so changes WHO plays whom, not whether double-elimination's
 * core guarantee holds (every player gets exactly two losses before
 * elimination, one grand final between the WB and LB champions), which is
 * preserved regardless of pairing order within the losers bracket. Byes
 * (null) are placed last so two real players are never denied a pairing
 * because a bye is between them.
 */
export function computeNextLosersRound(
  roundNumber: number,
  incomingPlayerIds: (string | null)[],
): BracketMatch[] {
  const real = incomingPlayerIds.filter((id): id is string => id !== null);
  const byeCount = incomingPlayerIds.length - real.length;
  const ordered = [...real, ...Array(byeCount).fill(null)];

  const matches: BracketMatch[] = [];
  for (let i = 0; i < ordered.length; i += 2) {
    matches.push({
      roundNumber,
      bracketPosition: i / 2,
      playerAId: ordered[i],
      playerBId: ordered[i + 1] ?? null,
    });
  }
  return matches;
}

/**
 * The grand final pairs the winners-bracket champion against the
 * losers-bracket champion. No bracket reset if the LB champion wins it (a
 * documented simplification -- see file header): the grand final is a
 * single deciding match, not "win twice from the loser's bracket to force
 * a second final."
 */
export function computeGrandFinal(
  roundNumber: number,
  winnersChampionId: string | null,
  losersChampionId: string | null,
): BracketMatch {
  return {
    roundNumber,
    bracketPosition: 0,
    playerAId: winnersChampionId,
    playerBId: losersChampionId,
  };
}

/**
 * Swiss round 1: standard "split field in half by seed, top half vs bottom
 * half" pairing (seed 1 vs seed ceil(n/2)+1, seed 2 vs ceil(n/2)+2, ...) --
 * avoids top seeds meeting each other in round 1, without needing any
 * results yet (there are none). Subsequent rounds need standings and
 * opponent history, which don't fit this interface's registrations-only
 * signature -- see computeNextSwissRound below for round 2+.
 */
export const swissGenerator: BracketGenerator = {
  generate(registrations: Registration[]): BracketMatch[] {
    const eligible = registrations.filter((r) =>
      r.checkedInAt !== null && !r.forfeited
    );
    const ordered = seededOrder(eligible);
    const half = Math.ceil(ordered.length / 2);
    const topHalf = ordered.slice(0, half);
    const bottomHalf = ordered.slice(half);

    const matches: BracketMatch[] = [];
    for (let i = 0; i < half; i++) {
      matches.push({
        roundNumber: 1,
        bracketPosition: i,
        playerAId: topHalf[i]?.userId ?? null,
        playerBId: bottomHalf[i]?.userId ?? null, // null = a bye if the field is odd
      });
    }
    return matches;
  },
};

export interface SwissStanding {
  userId: string;
  score: number; // wins so far (a draw/loss convention is a business-policy
  // decision left to the caller -- this function only needs relative
  // ordering, not how score itself is computed)
  seed: number | null;
  opponentIds: string[]; // every opponent already paired against, any round
}

/**
 * Swiss round 2+: groups players by score (descending), pairs within each
 * score group avoiding rematches (a real, standard Swiss requirement),
 * "floating" an unpaired player down to the next score group when a group
 * has an odd count or no valid pairing remains within it -- a simplified
 * but correct Dutch-system approximation. Does NOT implement color
 * balance or Buchholz/Sonneborn-Berger tiebreaks (Business Rules §5
 * doesn't specify those, and they're a ranking-tiebreak concern, not a
 * pairing one).
 */
export function computeNextSwissRound(
  roundNumber: number,
  standings: SwissStanding[],
): BracketMatch[] {
  const opponentsOf = new Map(
    standings.map((s) => [s.userId, new Set(s.opponentIds)]),
  );

  const groups = new Map<number, SwissStanding[]>();
  for (const s of standings) {
    const group = groups.get(s.score) ?? [];
    group.push(s);
    groups.set(s.score, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity));
  }

  const scoresDescending = [...groups.keys()].sort((a, b) => b - a);
  const pending: SwissStanding[] = [];
  const matches: BracketMatch[] = [];
  let bracketPosition = 0;

  for (const score of scoresDescending) {
    const pool = [...pending.splice(0), ...(groups.get(score) ?? [])];

    while (pool.length > 0) {
      const player = pool.shift()!;
      const opponents = opponentsOf.get(player.userId) ?? new Set();
      const opponentIndex = pool.findIndex((p) => !opponents.has(p.userId));

      if (opponentIndex === -1) {
        // No valid opponent left in this score group -- float down to the
        // next group rather than force a rematch.
        pending.push(player);
        continue;
      }

      const [opponent] = pool.splice(opponentIndex, 1);
      matches.push({
        roundNumber,
        bracketPosition: bracketPosition++,
        playerAId: player.userId,
        playerBId: opponent.userId,
      });
    }
  }

  // Anyone left after the lowest score group (an odd total field, or a
  // player who has already faced everyone at their level) gets a bye.
  for (const leftover of pending) {
    matches.push({
      roundNumber,
      bracketPosition: bracketPosition++,
      playerAId: leftover.userId,
      playerBId: null,
    });
  }

  return matches;
}

/**
 * Standard round-robin circle method: fix player 0, rotate the rest
 * through n-1 positions across n-1 rounds (n padded to even with a bye if
 * the field is odd), each round pairing opposite positions around the
 * circle. Every player faces every other player exactly once. Unlike
 * single-elimination, the ENTIRE schedule (every round) is knowable from
 * registrations alone -- returned as one BracketMatch[] spanning multiple
 * roundNumbers, not just round 1.
 */
export const roundRobinGenerator: BracketGenerator = {
  generate(registrations: Registration[]): BracketMatch[] {
    const eligible = registrations.filter((r) =>
      r.checkedInAt !== null && !r.forfeited
    );
    const ordered = seededOrder(eligible);
    const ids: (string | null)[] = ordered.map((r) => r.userId);
    if (ids.length % 2 !== 0) ids.push(null); // bye slot

    const n = ids.length;
    const rounds = n - 1;
    const matches: BracketMatch[] = [];

    // Circle method: index 0 stays fixed, the rest rotate one position
    // clockwise each round.
    const rotating = ids.slice(1);

    for (let round = 0; round < rounds; round++) {
      const circle = [ids[0], ...rotating];
      let bracketPosition = 0;
      for (let i = 0; i < n / 2; i++) {
        const playerA = circle[i];
        const playerB = circle[n - 1 - i];
        if (playerA !== null && playerB !== null) {
          matches.push({
            roundNumber: round + 1,
            bracketPosition: bracketPosition++,
            playerAId: playerA,
            playerBId: playerB,
          });
        }
      }
      rotating.push(rotating.shift()!);
    }

    return matches;
  },
};

export function getBracketGenerator(
  format: "single_elim" | "double_elim" | "round_robin" | "swiss",
): BracketGenerator {
  switch (format) {
    case "single_elim":
      return singleEliminationGenerator;
    case "double_elim":
      return doubleEliminationGenerator;
    case "round_robin":
      return roundRobinGenerator;
    case "swiss":
      return swissGenerator;
  }
}

/**
 * Computes the next round's matches from the current round's results.
 * Winners advance paired in bracket order (position 0 vs 1 -> next
 * position 0, position 2 vs 3 -> next position 1, etc.) — standard
 * single-elimination advancement.
 */
export function computeNextRound(
  currentRoundNumber: number,
  currentRoundResults: { bracketPosition: number; winnerId: string | null }[],
): BracketMatch[] {
  const sorted = [...currentRoundResults].sort((a, b) =>
    a.bracketPosition - b.bracketPosition
  );
  const matches: BracketMatch[] = [];

  for (let i = 0; i < sorted.length; i += 2) {
    matches.push({
      roundNumber: currentRoundNumber + 1,
      bracketPosition: i / 2,
      playerAId: sorted[i]?.winnerId ?? null,
      playerBId: sorted[i + 1]?.winnerId ?? null,
    });
  }

  return matches;
}
