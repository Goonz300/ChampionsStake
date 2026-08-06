"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRealtimeClient } from "@/lib/realtime/client";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import type { TypingBroadcastPayload } from "@/lib/realtime/types";

const STALE_TIMEOUT_MS = 5_000; // a typing_started with no follow-up in 5s is treated as stopped
const START_DEBOUNCE_MS = 2_000; // at most one typing_started broadcast per 2s of continuous typing
const AUTO_STOP_MS = 3_000; // auto-broadcast typing_stopped 3s after the last keystroke

/**
 * Per-challenge typing indicator (_realtime/typing.ts's own channel
 * naming: `chat:{challengeId}`, channel-isolated per challenge). The
 * server intentionally never tracks "who is currently typing" -- see that
 * file's own comment -- so ALL of "automatic timeout," "stale indicator
 * removal," and rate-limit-friendly debouncing are this hook's job, not
 * duplicated server logic.
 */
export function useTyping(challengeId: string | null | undefined) {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const staleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function clearStaleTimer(userId: string) {
    const timer = staleTimersRef.current.get(userId);
    if (timer) clearTimeout(timer);
    staleTimersRef.current.delete(userId);
  }

  function removeTypingUser(userId: string) {
    clearStaleTimer(userId);
    setTypingUserIds((prev) => prev.filter((id) => id !== userId));
  }

  const channelName = challengeId ? `chat:${challengeId}` : null;

  useRealtimeChannel(
    channelName,
    (channel) => {
      channel.on(
        "broadcast",
        { event: "typing_started" },
        ({ payload }: { payload: TypingBroadcastPayload }) => {
          setTypingUserIds((prev) =>
            prev.includes(payload.userId) ? prev : [...prev, payload.userId],
          );
          clearStaleTimer(payload.userId);
          staleTimersRef.current.set(
            payload.userId,
            setTimeout(() => removeTypingUser(payload.userId), STALE_TIMEOUT_MS),
          );
        },
      );
      channel.on(
        "broadcast",
        { event: "typing_stopped" },
        ({ payload }: { payload: TypingBroadcastPayload }) => {
          removeTypingUser(payload.userId);
        },
      );
      // Phase 4 independent-review fix: marks this channel private so
      // migration 0078's realtime.messages RLS policies (participant-only
      // broadcast) are actually consulted -- without this, Broadcast has no
      // backing table for RLS to govern at all, and any authenticated client
      // could send/receive on this channel regardless of participation.
    },
    { private: true },
  );

  // Reconnect cleanup: dropping all locally-tracked typing state on a
  // channel change (challengeId change, or the underlying channel being
  // torn down/re-created by useRealtimeChannel) avoids a stale indicator
  // surviving into a session it no longer applies to.
  useEffect(() => {
    const timers = staleTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      setTypingUserIds([]);
    };
  }, [challengeId]);

  const lastStartRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Call on every keystroke in the message composer. Internally
   * debounces the typing_started broadcast (at most one per
   * START_DEBOUNCE_MS) and auto-broadcasts typing_stopped after
   * AUTO_STOP_MS of silence -- callers never need to call anything to
   * "stop" typing themselves. */
  const notifyTyping = useCallback(() => {
    if (!challengeId) return;
    const supabase = getRealtimeClient();
    const now = Date.now();

    if (now - lastStartRef.current > START_DEBOUNCE_MS) {
      lastStartRef.current = now;
      void supabase.functions
        .invoke("typing-update", {
          body: { challengeId, isTyping: true },
        })
        .catch(() => {});
    }

    clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      void supabase.functions
        .invoke("typing-update", {
          body: { challengeId, isTyping: false },
        })
        .catch(() => {});
    }, AUTO_STOP_MS);
  }, [challengeId]);

  useEffect(() => {
    return () => clearTimeout(stopTimerRef.current);
  }, [challengeId]);

  return { typingUserIds, notifyTyping };
}
