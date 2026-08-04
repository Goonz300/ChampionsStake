// supabase/functions/_tournament/bracket.ts
//
// SCOPE: single elimination is fully implemented. Double elimination, Swiss,
// and round robin are architecture-ready (a BracketGenerator interface any
// of them can implement) but NOT implemented — per this phase's explicit
// "architecture ready" instruction for double elim, and Business Rules §5
// only actually specifying single/double-elim/round-robin as *possible*
// formats without detailing the latter two's rules closely enough to
// implement without inventing tiebreak/pairing rules unilaterally.

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
  return [...registrations].sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER));
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
    const eligible = registrations.filter((r) => r.checkedInAt !== null && !r.forfeited);
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
      seedIndex < ordered.length ? ordered[seedIndex] : null,
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

/** Not implemented — architecture-ready only, per this phase's brief. */
export const doubleEliminationGenerator: BracketGenerator = {
  generate(): BracketMatch[] {
    throw new Error(
      "Double-elimination bracket generation is architecture-ready only (TOURNAMENT-001) — " +
        "not implemented. Implement this by tracking a winners bracket and losers bracket " +
        "separately; the BracketGenerator interface is stable so callers don't need to change.",
    );
  },
};

/** Not implemented — architecture-ready only. */
export const swissGenerator: BracketGenerator = {
  generate(): BracketMatch[] {
    throw new Error(
      "Swiss-format pairing is architecture-ready only (TOURNAMENT-001) — not implemented. " +
        "Real Swiss pairing needs a round-by-round pairing algorithm (e.g. Dutch system) " +
        "that Business Rules §5 doesn't specify closely enough to implement without inventing " +
        "tiebreak rules unilaterally.",
    );
  },
};

/** Not implemented — architecture-ready only. */
export const roundRobinGenerator: BracketGenerator = {
  generate(): BracketMatch[] {
    throw new Error(
      "Round-robin scheduling is architecture-ready only (TOURNAMENT-001) — not implemented.",
    );
  },
};

export function getBracketGenerator(format: "single_elim" | "double_elim" | "round_robin"): BracketGenerator {
  switch (format) {
    case "single_elim":
      return singleEliminationGenerator;
    case "double_elim":
      return doubleEliminationGenerator;
    case "round_robin":
      return roundRobinGenerator;
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
  const sorted = [...currentRoundResults].sort((a, b) => a.bracketPosition - b.bracketPosition);
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
