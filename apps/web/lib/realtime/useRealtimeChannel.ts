"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "./client";

/**
 * The one place every realtime hook in this app creates/subscribes/tears
 * down a Supabase Realtime channel -- so "prevent subscription leaks,
 * duplicate listeners, memory leaks" (this phase's Performance section)
 * only needs to be gotten right once, not six times.
 *
 * `channelName` null/undefined means "not ready yet" (e.g. a hook waiting
 * on a challengeId prop that hasn't loaded) -- no channel is created, and
 * effect cleanup correctly tears down whatever channel existed for a
 * PRIOR name before creating the new one. Reconnection itself is handled
 * by the underlying Supabase Realtime client (bounded, exponential --
 * this hook does not reimplement transport-level reconnect logic, only
 * ensures the channel this component asked for is torn down on unmount
 * and re-created if `channelName` changes).
 *
 * `configure` is captured in a ref so the effect's dependency list only
 * needs `channelName` -- a caller passing a fresh arrow function every
 * render (the common case) does not cause a resubscribe storm, while the
 * LATEST configure logic (closing over current props/state setters) still
 * runs on every real (re)subscription.
 */
export interface UseRealtimeChannelOptions {
  /** Set true for any channel that uses Broadcast or Presence (not just
   * Postgres Changes) -- required for migration 0078's realtime.messages
   * RLS policies to actually be consulted at all. Postgres-Changes-only
   * channels (the majority of this app's hooks) don't need this: that
   * transport is always governed by the underlying table's own RLS,
   * private or not. */
  private?: boolean;
}

export function useRealtimeChannel(
  channelName: string | null | undefined,
  configure: (channel: RealtimeChannel) => void,
  options: UseRealtimeChannelOptions = {},
): void {
  const configureRef = useRef(configure);
  configureRef.current = configure;
  const isPrivate = options.private ?? false;

  useEffect(() => {
    if (!channelName) return;

    const supabase = getRealtimeClient();
    const channel = supabase.channel(channelName, { config: { private: isPrivate } });
    configureRef.current(channel);
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName, isPrivate]);
}
