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
import {
  approveHeldWithdrawal,
  rejectHeldWithdrawal,
} from "../_payment/withdrawal-service.ts";
import {
  addToSanctionsBlocklist,
  listSanctionsBlocklist,
  removeFromSanctionsBlocklist,
} from "../_payment/sanctions.ts";
import { listChargebacks, recordChargeback } from "../_payment/chargebacks.ts";

export const adminGetBalance = getBalance;
export const adminFreezeWallet = freezeWallet;
export const adminUnfreezeWallet = unfreezeWallet;
export const adminApproveWithdrawal = approveHeldWithdrawal;
export const adminRejectWithdrawal = rejectHeldWithdrawal;
export const adminAddSanctionsBlocklistEntry = addToSanctionsBlocklist;
export const adminRemoveSanctionsBlocklistEntry = removeFromSanctionsBlocklist;
export const adminListSanctionsBlocklist = listSanctionsBlocklist;
export const adminRecordChargeback = recordChargeback;
export const adminListChargebacks = listChargebacks;

/** Phase 6: withdrawals held for manual review (Layer "high-value
 * withdrawal" risk control) -- the admin queue this feeds. */
export async function adminListPendingReviewWithdrawals(limit = 50) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("payment_intents")
    .select("id, user_id, amount_cents, created_at, payout_method_id")
    .eq("kind", "withdrawal")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(
      `Failed to list pending-review withdrawals: ${error.message}`,
    );
  }
  return data ?? [];
}

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
