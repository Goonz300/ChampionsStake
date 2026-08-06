"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `onSync(sinceIso)` once on mount, then again every time the
 * browser regains connectivity (the 'online' event) -- covers both "the
 * app was opened fresh" and "wifi dropped and came back" (this phase's
 * Offline Handling section). `sinceIso` is the ISO timestamp of the last
 * successful sync call (or mount time, the first call), so `onSync`
 * typically calls GET /sync-events?since=... and merges the result --
 * event replay and duplicate suppression are sync-events' own job
 * (_realtime/sync.ts's strict `gt`, not `gte`), not reinvented here.
 */
export function useSyncOnReconnect(onSync: (sinceIso: string) => void): void {
  const lastSyncRef = useRef<string>(new Date().toISOString());
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    function sync() {
      const since = lastSyncRef.current;
      lastSyncRef.current = new Date().toISOString();
      onSyncRef.current(since);
    }

    sync();

    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, []);
}
