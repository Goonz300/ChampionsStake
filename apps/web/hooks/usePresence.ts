"use client";

import { useEffect, useRef, useState } from "react";
import { getRealtimeClient } from "@/lib/realtime/client";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import type { PresenceRow, PresenceStatus } from "@/lib/realtime/types";

const HEARTBEAT_INTERVAL_MS = 30_000; // matches presence-update's own 10-req/30s rate limit
const IDLE_THRESHOLD_MS = 2 * 60_000; // matches sweepStalePresence's 2-minute cutoff

export interface UsePresenceOptions {
  /** Reported to presence-update as currentChallengeId, if the caller is
   * currently viewing/in a specific challenge. */
  challengeId?: string;
  /** Reported to presence-update as currentTournamentId (Phase 4 addition). */
  tournamentId?: string;
  /** User ids to watch via Postgres Changes on user_presence (RLS already
   * scopes what's visible: self, or a shared challenge/tournament). */
  watchUserIds?: string[];
}

/**
 * Manages the caller's own presence (heartbeat while the tab is visible,
 * idle detection, best-effort offline notice on unmount/unload -- the
 * authoritative disconnect-cleanup backstop for an UNCLEAN disconnect is
 * the server-side presence-sweep cron, not this hook) and returns live
 * presence for any watched users via a user_presence Postgres Changes
 * subscription.
 */
export function usePresence(options: UsePresenceOptions = {}) {
  const { challengeId, tournamentId, watchUserIds = [] } = options;
  const [presenceByUser, setPresenceByUser] = useState<Record<string, PresenceRow>>({});

  useEffect(() => {
    const supabase = getRealtimeClient();
    let currentStatus: PresenceStatus = "online";
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    async function push(status: PresenceStatus) {
      currentStatus = status;
      await supabase.functions
        .invoke("presence-update", {
          body: {
            status,
            currentChallengeId: challengeId ?? null,
            currentTournamentId: tournamentId ?? null,
          },
        })
        .catch(() => {
          // Best-effort -- a missed heartbeat self-heals on the next
          // interval tick, and an unclean disconnect is covered by the
          // server-side sweep regardless.
        });
    }

    function resetIdleTimer() {
      if (currentStatus === "away") void push("online");
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => void push("away"), IDLE_THRESHOLD_MS);
    }

    void push("online");
    resetIdleTimer();

    const heartbeat = setInterval(() => void push(currentStatus), HEARTBEAT_INTERVAL_MS);
    window.addEventListener("mousemove", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    window.addEventListener("visibilitychange", resetIdleTimer);

    function handleUnload() {
      void push("offline");
    }
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(heartbeat);
      clearTimeout(idleTimer);
      window.removeEventListener("mousemove", resetIdleTimer);
      window.removeEventListener("keydown", resetIdleTimer);
      window.removeEventListener("visibilitychange", resetIdleTimer);
      window.removeEventListener("beforeunload", handleUnload);
      void push("offline");
    };
  }, [challengeId, tournamentId]);

  const watchKey =
    watchUserIds.length > 0 ? `presence:watch:${watchUserIds.slice().sort().join(",")}` : null;
  const watchIdsRef = useRef(watchUserIds);
  watchIdsRef.current = watchUserIds;

  useRealtimeChannel(watchKey, (channel) => {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "user_presence" },
      (payload) => {
        const row = (payload.new ?? payload.old) as PresenceRow | null;
        if (!row || !watchIdsRef.current.includes(row.user_id)) return;
        setPresenceByUser((prev) => ({ ...prev, [row.user_id]: row }));
      },
    );
  });

  return { presenceByUser };
}
