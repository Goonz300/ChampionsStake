"use client";

import { useEffect, useState } from "react";
import { useTournamentEvents } from "@/hooks/useTournamentEvents";

interface RoundRow {
  id: string;
  round_number: number;
  status: string;
}

interface MatchRow {
  id: string;
  round_id: string;
  bracket_position: number;
  challenge_id: string | null;
}

function upsertAll<T extends { id: string }>(base: T[], updates: T[]): T[] {
  const byId = new Map(base.map((r) => [r.id, r]));
  for (const u of updates) byId.set(u.id, u);
  return [...byId.values()];
}

/**
 * Live bracket view: initial state fetched once on mount (tournament-browse's
 * existing bracket view), then layered with useTournamentEvents' live
 * Postgres Changes deltas -- that hook (already existed, Phase 4) only
 * tracks deltas from the moment it subscribes, not a full initial snapshot,
 * so this component supplies the snapshot itself rather than the hook
 * needing to change.
 */
export function BracketView({ tournamentId }: { tournamentId: string }) {
  const [initialRounds, setInitialRounds] = useState<RoundRow[]>([]);
  const [initialMatches, setInitialMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/tournaments?view=bracket&tournamentId=${tournamentId}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const rounds: RoundRow[] = (body.data ?? []).map((r: RoundRow) => ({
          id: r.id,
          round_number: r.round_number,
          status: r.status,
        }));
        const matches: MatchRow[] = (body.data ?? []).flatMap(
          (r: { tournament_matches?: MatchRow[] }) => r.tournament_matches ?? [],
        );
        setInitialRounds(rounds);
        setInitialMatches(matches);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  const live = useTournamentEvents(tournamentId);
  const rounds = upsertAll(initialRounds, live.rounds as unknown as RoundRow[]).sort(
    (a, b) => a.round_number - b.round_number,
  );
  const matches = upsertAll(initialMatches, live.matches as unknown as MatchRow[]);

  if (loading) {
    return <p className="font-exo text-vv-text-tertiary text-sm">Loading bracket...</p>;
  }

  if (rounds.length === 0) {
    return (
      <p className="font-exo text-vv-text-tertiary text-sm">Bracket has not been generated yet.</p>
    );
  }

  return (
    <div className="flex gap-6 overflow-x-auto">
      {rounds.map((round) => (
        <div key={round.id} className="min-w-[200px] shrink-0">
          <h3 className="font-exo text-vv-text-secondary mb-2 text-xs uppercase">
            Round {round.round_number} &middot; {round.status}
          </h3>
          <ul className="space-y-2">
            {matches
              .filter((m) => m.round_id === round.id)
              .sort((a, b) => a.bracket_position - b.bracket_position)
              .map((m) => (
                <li
                  key={m.id}
                  className="border-vv-divider font-exo rounded border p-2 text-xs text-white"
                >
                  Match {m.bracket_position + 1}
                  {!m.challenge_id && <span className="text-vv-text-tertiary"> (bye)</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
