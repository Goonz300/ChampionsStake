"use client";

import { useCallback, useState } from "react";
import { getRealtimeClient } from "@/lib/realtime/client";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import { useSyncOnReconnect } from "@/lib/realtime/useSyncOnReconnect";
import type { WalletRow } from "@/lib/realtime/types";

/** wallet-balance (the Edge Function) returns a camelCase WalletBalances
 * shape (walletId/availableCents/escrowedCents...), NOT the raw
 * snake_case `wallets` table row Postgres Changes delivers. Normalizing
 * here keeps this hook's `wallet` state one consistent shape regardless
 * of which source last updated it -- without this, a reconnect-triggered
 * refresh would silently produce a wallet object with undefined
 * available_cents/escrowed_cents. */
interface WalletBalanceResponse {
  walletId: string;
  userId: string;
  status: "active" | "frozen";
  currency: string;
  availableCents: number;
  escrowedCents: number;
}

function toWalletRow(balance: WalletBalanceResponse): WalletRow {
  return {
    id: balance.walletId,
    user_id: balance.userId,
    status: balance.status,
    currency: balance.currency,
    available_cents: balance.availableCents,
    escrowed_cents: balance.escrowedCents,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Live wallet balance for the given user, via Postgres Changes on
 * `wallets` (migration 0053's publication; RLS scopes this to the
 * caller's own wallet). Unlike useNotifications/useChallengeEvents, a
 * wallet is current-state, not an event stream, so reconnect handling is
 * a plain re-fetch (the existing wallet-balance Edge Function) rather
 * than a timestamp-based replay -- Postgres Changes only streams events
 * that occur WHILE connected, so a balance change that happened during a
 * disconnect window would otherwise be silently missed until the next
 * unrelated update.
 */
export function useWalletEvents(userId: string | null | undefined) {
  const [wallet, setWallet] = useState<WalletRow | null>(null);

  useSyncOnReconnect(
    useCallback(async () => {
      if (!userId) return;
      const supabase = getRealtimeClient();
      const { data } = await supabase.functions.invoke("wallet-balance", { method: "GET" });
      if (data?.data) setWallet(toWalletRow(data.data as WalletBalanceResponse));
    }, [userId]),
  );

  const channelName = userId ? `wallet:${userId}` : null;

  useRealtimeChannel(channelName, (channel) => {
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` },
      (payload) => setWallet(payload.new as WalletRow),
    );
  });

  return { wallet };
}
