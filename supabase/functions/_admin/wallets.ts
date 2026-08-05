// supabase/functions/_admin/wallets.ts
//
// Read-only by default, per this phase's brief. Every write action here is
// a direct pass-through to WALLET-001's existing functions -- freeze/
// unfreeze, statement generation, and the four-eyes adjustment flow are
// ALL implemented in _wallet/ already; this file adds zero new financial
// logic, only admin-scoped access to what exists.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  freezeWallet,
  getBalance,
  unfreezeWallet,
} from "../_wallet/service.ts";
import {
  getWalletByUserIdOrThrow,
  listTransactions,
} from "../_wallet/repository.ts";
import { generateStatement, statementToCsv } from "../_wallet/statements.ts";

export const adminGetBalance = getBalance;
export const adminFreezeWallet = freezeWallet;
export const adminUnfreezeWallet = unfreezeWallet;

export async function adminGetTransactions(
  userId: string,
  limit: number,
  cursor?: string,
) {
  const wallet = await getWalletByUserIdOrThrow(userId);
  return listTransactions({ walletId: wallet.walletId, limit, cursor });
}

export async function adminGetLedger(userId: string, limit: number) {
  const wallet = await getWalletByUserIdOrThrow(userId);
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("wallet_ledger")
    .select("*")
    .eq("wallet_id", wallet.walletId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch ledger: ${error.message}`);
  return data ?? [];
}

export async function adminExportStatement(
  userId: string,
  from: string,
  to: string,
  format: "json" | "csv",
) {
  const wallet = await getWalletByUserIdOrThrow(userId);
  const statement = await generateStatement(wallet.walletId, from, to);
  return format === "csv" ? statementToCsv(statement) : statement;
}
