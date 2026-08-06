"use client";

import { useEffect, useRef, useState } from "react";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import type { TournamentMatchRow, TournamentRoundRow } from "@/lib/realtime/types";

function upsertById<T extends { id: string }>(existing: T[], row: T): T[] {
  const index = existing.findIndex((r) => r.id === row.id);
  if (index === -1) return [...existing, row];
  const next = existing.slice();
  next[index] = row;
  return next;
}

/**
 * Live tournament bracket state: rounds and matches for a single
 * tournamentId, via Postgres Changes on `tournament_rounds`/
 * `tournament_matches` (both already in the supabase_realtime
 * publication, migration 0053). Channel-isolated per tournament. Unlike
 * useNotifications/useChallengeEvents, this has no separate resync
 * endpoint to call on reconnect -- bracket state is small and naturally
 * idempotent to re-derive (a caller reconnecting can simply re-fetch the
 * current bracket via the existing tournament-browse Edge Function rather
 * than needing a timestamp-based event replay, which is why this hook
 * doesn't wrap useSyncOnReconnect).
 */
export function useTournamentEvents(tournamentId: string | null | undefined) {
  const [rounds, setRounds] = useState<TournamentRoundRow[]>([]);
  const [matches, setMatches] = useState<TournamentMatchRow[]>([]);

  // The tournament_matches postgres_changes callback below is registered
  // ONCE per channel subscription, not re-created on every render -- a
  // plain closure over `rounds` would go stale the moment rounds changes
  // after subscribing. A ref keeps the check reading live state.
  const roundsRef = useRef(rounds);
  useEffect(() => {
    roundsRef.current = rounds;
  }, [rounds]);

  const channelName = tournamentId ? `tournament:${tournamentId}` : null;

  useRealtimeChannel(channelName, (channel) => {
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tournament_rounds",
        filter: `tournament_id=eq.${tournamentId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as TournamentRoundRow | undefined;
        if (row) setRounds((prev) => upsertById(prev, row));
      },
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tournament_matches" },
      (payload) => {
        const row = (payload.new ?? payload.old) as TournamentMatchRow | undefined;
        // tournament_matches has no tournament_id column directly (it
        // belongs to a round, which belongs to the tournament) -- filter
        // client-side against the rounds we already know about rather
        // than an unsupported cross-table Postgres Changes filter.
        if (row && roundsRef.current.some((r) => r.id === row.round_id)) {
          setMatches((prev) => upsertById(prev, row));
        }
      },
    );
  });

  return { rounds, matches };
}
