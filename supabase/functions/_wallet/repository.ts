// supabase/functions/_wallet/repository.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { NotFoundError } from "../_shared/errors/index.ts";
import type { WalletBalances } from "./types.ts";

function toWalletBalances(row: Record<string, unknown>): WalletBalances {
  return {
    walletId: row.id as string,
    userId: row.user_id as string,
    status: row.status as "active" | "frozen",
    currency: row.currency as string,
    availableCents: row.available_cents as number,
    escrowedCents: row.escrowed_cents as number,
    pendingCents: row.pending_cents as number,
    bonusCents: row.bonus_cents as number,
    referralCents: row.referral_cents as number,
  };
}

export async function findWalletByUserId(userId: string): Promise<WalletBalances | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle();

  if (error) throw new Error(`Failed to look up wallet for user ${userId}: ${error.message}`);
  return data ? toWalletBalances(data) : null;
}

export async function getWalletByUserIdOrThrow(userId: string): Promise<WalletBalances> {
  const wallet = await findWalletByUserId(userId);
  if (!wallet) throw new NotFoundError(`No wallet exists for user ${userId}.`);
  return wallet;
}

export async function getWalletById(walletId: string): Promise<WalletBalances> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("wallets").select("*").eq("id", walletId).maybeSingle();

  if (error) throw new Error(`Failed to look up wallet ${walletId}: ${error.message}`);
  if (!data) throw new NotFoundError(`Wallet ${walletId} does not exist.`);
  return toWalletBalances(data);
}

export interface TransactionHistoryFilter {
  walletId: string;
  type?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  cursor?: string;
  limit: number;
}

/**
 * Lists transactions touching a wallet. Deliberately queries via
 * wallet_ledger (which records every wallet a transaction actually
 * affected) rather than filtering wallet_transactions.wallet_id directly —
 * see ledger.ts's design note on why wallet_id alone would miss a wallet
 * that was only the *secondary* party in a multi-wallet transfer (e.g. the
 * receiving side of a future escrow release).
 */
export async function listTransactions(filter: TransactionHistoryFilter) {
  const supabase = getServiceRoleClient();

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("wallet_ledger")
    .select("wallet_transaction_id")
    .eq("wallet_id", filter.walletId);

  if (ledgerError) throw new Error(`Failed to look up ledger entries: ${ledgerError.message}`);

  const transactionIds = [...new Set((ledgerRows ?? []).map((r) => r.wallet_transaction_id as string))];
  if (transactionIds.length === 0) return [];

  let query = supabase
    .from("wallet_transactions")
    .select("*")
    .in("id", transactionIds)
    .order("created_at", { ascending: false })
    .limit(filter.limit);

  if (filter.type) query = query.eq("type", filter.type);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.fromDate) query = query.gte("created_at", filter.fromDate);
  if (filter.toDate) query = query.lte("created_at", filter.toDate);
  if (filter.cursor) query = query.lt("created_at", filter.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list transactions: ${error.message}`);
  return data ?? [];
}

export async function getTransactionById(transactionId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch transaction ${transactionId}: ${error.message}`);
  if (!data) throw new NotFoundError(`Transaction ${transactionId} does not exist.`);
  return data;
}

/** All wallets, for reconciliation sweeps. Paginated by the caller via
 * (limit, afterId) to avoid loading 100,000+ rows into memory at once —
 * this phase's explicit "100,000+ wallets" performance requirement. */
export async function listWalletsPage(limit: number, afterId: string | null) {
  const supabase = getServiceRoleClient();
  let query = supabase.from("wallets").select("*").order("id", { ascending: true }).limit(limit);
  if (afterId) query = query.gt("id", afterId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to page through wallets: ${error.message}`);
  return (data ?? []).map(toWalletBalances);
}
