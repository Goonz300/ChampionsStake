"use client";

import { useCallback, useState } from "react";
import { getRealtimeClient } from "@/lib/realtime/client";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import { useSyncOnReconnect } from "@/lib/realtime/useSyncOnReconnect";
import { mergeById } from "@/lib/realtime/dedupe";
import type { NotificationRow } from "@/lib/realtime/types";

/**
 * Live in-app notification feed for the given user: an initial load (and
 * every reconnect) via GET /sync-events, kept current afterward via a
 * Postgres Changes subscription on `notifications` (already in the
 * supabase_realtime publication, migration 0053; RLS already scopes rows
 * to the caller). The two sources are merged and de-duplicated by id
 * (lib/realtime/dedupe.ts) -- a notification created while briefly
 * offline can legitimately arrive from both the resync and, once the
 * channel re-subscribes, a live event.
 */
export function useNotifications(userId: string | null | undefined) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  useSyncOnReconnect(
    useCallback(
      async (since: string) => {
        if (!userId) return;
        const supabase = getRealtimeClient();
        const { data } = await supabase.functions.invoke(
          `sync-events?since=${encodeURIComponent(since)}`,
          { method: "GET" },
        );
        const fetched = (data?.data?.notifications ?? []) as NotificationRow[];
        if (fetched.length > 0) {
          setNotifications((prev) => mergeById(prev, fetched));
        }
      },
      [userId],
    ),
  );

  const channelName = userId ? `notifications:${userId}` : null;

  useRealtimeChannel(channelName, (channel) => {
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as NotificationRow | undefined;
        if (!row) return;
        setNotifications((prev) => mergeById(prev, [row]));
      },
    );
  });

  const markRead = useCallback(async (notificationId: string) => {
    const supabase = getRealtimeClient();
    await supabase.functions
      .invoke("mark-read", {
        body: { target: "notification", notificationId },
      })
      .catch(() => {});
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, status: "read" } : n)),
    );
  }, []);

  const markAllRead = useCallback(async () => {
    const supabase = getRealtimeClient();
    await supabase.functions
      .invoke("mark-read", {
        body: { target: "all_notifications" },
      })
      .catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, status: "read" })));
  }, []);

  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  return { notifications, unreadCount, markRead, markAllRead };
}
