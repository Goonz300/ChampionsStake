"use client";

import { useCallback, useState } from "react";
import { getRealtimeClient } from "@/lib/realtime/client";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import { useSyncOnReconnect } from "@/lib/realtime/useSyncOnReconnect";
import { mergeById } from "@/lib/realtime/dedupe";
import type { ChallengeRow, ChatMessageRow } from "@/lib/realtime/types";

export interface SendMessageInput {
  type: "text" | "image" | "video" | "voice";
  content?: string;
  fileUploadId?: string;
}

/**
 * Live challenge state (status/escrow-relevant fields via Postgres
 * Changes on `challenges`) plus that challenge's chat (`challenge_messages`),
 * both scoped to a single challengeId -- channel-isolated per challenge,
 * never a global subscription. Initial load and reconnect resync go
 * through GET /sync-events?challengeId=..., which reuses
 * _realtime/sync.ts's existing syncChallengeSince (strict `gt`, no
 * duplicate replay) rather than a new fetch endpoint.
 *
 * `sendMessage` is a thin, idempotency-key-bearing wrapper over chat-send
 * (Phase 4 fix, see that function's own doc comment) -- it does not
 * attempt local optimistic reconciliation itself (that needs the caller's
 * own userId to render a placeholder correctly); callers wanting an
 * optimistic UI can render their own temp message, call this, and replace
 * it with the real one once send resolves or once it arrives via the
 * subscription above, whichever comes first.
 */
export function useChallengeEvents(challengeId: string | null | undefined) {
  const [challenge, setChallenge] = useState<ChallengeRow | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);

  useSyncOnReconnect(
    useCallback(
      async (since: string) => {
        if (!challengeId) return;
        const supabase = getRealtimeClient();
        const { data } = await supabase.functions.invoke(
          `sync-events?since=${encodeURIComponent(since)}&challengeId=${challengeId}`,
          { method: "GET" },
        );
        const fetched = (data?.data?.messages ?? []) as ChatMessageRow[];
        if (fetched.length > 0) {
          setMessages((prev) => mergeById(prev, fetched));
        }
      },
      [challengeId],
    ),
  );

  const channelName = challengeId ? `challenge:${challengeId}` : null;

  useRealtimeChannel(channelName, (channel) => {
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "challenges", filter: `id=eq.${challengeId}` },
      (payload) => setChallenge(payload.new as ChallengeRow),
    );
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "challenge_messages",
        filter: `challenge_id=eq.${challengeId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as ChatMessageRow | undefined;
        if (row) setMessages((prev) => mergeById(prev, [row]));
      },
    );
  });

  const sendMessage = useCallback(
    async (input: SendMessageInput): Promise<{ id: string } | null> => {
      if (!challengeId) return null;
      const supabase = getRealtimeClient();
      const { data, error } = await supabase.functions.invoke("chat-send", {
        body: { challengeId, ...input },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (error) return null;
      return (data?.data ?? null) as { id: string } | null;
    },
    [challengeId],
  );

  return { challenge, messages, sendMessage };
}
