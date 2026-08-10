// supabase/functions/_wallet/reconciliation.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { listWalletsPage } from "./repository.ts";
import { freezeWallet } from "./service.ts";
import { logger } from "../_shared/logger/index.ts";

interface MismatchRecord {
  wallet_id: string;
  account_type: "available" | "escrowed" | "pending" | "bonus" | "referral";
  cached_cents: number;
  ledger_derived_cents: number;
  drift_cents: number;
}

const PAGE_SIZE = 500;
const ACCOUNT_TYPES = [
  "available",
  "escrowed",
  "pending",
  "bonus",
  "referral",
] as const;

/**
 * Runs a full reconciliation sweep: for every wallet, compares its 5 cached
 * balance columns against the ledger-derived truth (fn_wallet_balance, the
 * same function the sync trigger itself uses — so a mismatch here means
 * the trigger failed to fire or something wrote around it, which should be
 * structurally impossible given DB-002's REVOKE + guard trigger, but "should
 * be impossible" is exactly what reconciliation exists to verify rather than
 * assume). Freezes any wallet with a mismatch, per Business Rules §15
 * ("divergence freezes the affected wallet pending manual review").
 *
 * Paginates through wallets PAGE_SIZE at a time rather than loading all
 * 100,000+ at once (this phase's explicit scale requirement).
 */
export async function runReconciliation(triggeredBy: string | null): Promise<{
  runId: string;
  walletsChecked: number;
  mismatchesFound: number;
  walletsFrozen: number;
}> {
  const supabase = getServiceRoleClient();
  const startedAt = new Date().toISOString();

  const { data: runRow, error: startError } = await supabase
    .from("wallet_reconciliation_runs")
    .insert({
      started_at: startedAt,
      triggered_by: triggeredBy,
      status: "completed",
    })
    .select("id")
    .single();

  if (startError || !runRow) {
    throw new Error(
      `Failed to start reconciliation run: ${startError?.message}`,
    );
  }

  const runId = runRow.id as string;
  const mismatches: MismatchRecord[] = [];
  let walletsChecked = 0;
  let cursor: string | null = null;

  try {
    for (;;) {
      const page = await listWalletsPage(PAGE_SIZE, cursor);
      if (page.length === 0) break;

      for (const wallet of page) {
        walletsChecked += 1;

        const cachedByType: Record<(typeof ACCOUNT_TYPES)[number], number> = {
          available: wallet.availableCents,
          escrowed: wallet.escrowedCents,
          pending: wallet.pendingCents,
          bonus: wallet.bonusCents,
          referral: wallet.referralCents,
        };

        // Phase 8.5 performance review fix: the 5 account-type checks per
        // wallet were fully sequential (5 awaited round trips before
        // moving to the next wallet) -- for a 100,000-wallet sweep (this
        // function's own stated design target) that's ~500,000 serialized
        // RPC calls. Each account type is an independent check against a
        // different wallet_ledger slice, so running them concurrently is
        // safe -- it only changes wall-clock time, not what gets checked.
        const results = await Promise.all(
          ACCOUNT_TYPES.map(async (accountType) => {
            const { data: fnResult, error: fnError } = await supabase.rpc(
              "fn_wallet_balance",
              {
                p_wallet_id: wallet.walletId,
                p_account_type: accountType,
              },
            );
            return { accountType, fnResult, fnError };
          }),
        );

        for (const { accountType, fnResult, fnError } of results) {
          if (fnError) {
            logger.error("Reconciliation: fn_wallet_balance call failed", {
              walletId: wallet.walletId,
              accountType,
              error: fnError.message,
            });
            continue;
          }

          const ledgerDerived = Number(fnResult ?? 0);
          const cached = cachedByType[accountType];

          if (ledgerDerived !== cached) {
            mismatches.push({
              wallet_id: wallet.walletId,
              account_type: accountType,
              cached_cents: cached,
              ledger_derived_cents: ledgerDerived,
              drift_cents: cached - ledgerDerived,
            });
          }
        }
      }

      cursor = page[page.length - 1]?.walletId ?? null;
      if (page.length < PAGE_SIZE) break;
    }

    const mismatchedWalletIds = [
      ...new Set(mismatches.map((m) => m.wallet_id)),
    ];
    for (const walletId of mismatchedWalletIds) {
      await freezeWallet(
        walletId,
        "Reconciliation mismatch detected — frozen pending manual review.",
        null,
      );
    }

    await supabase
      .from("wallet_reconciliation_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: mismatches.length > 0
          ? "completed_with_mismatches"
          : "completed",
        wallets_checked: walletsChecked,
        mismatches_found: mismatches.length,
        wallets_frozen: mismatchedWalletIds.length,
        details: mismatches,
      })
      .eq("id", runId);

    return {
      runId,
      walletsChecked,
      mismatchesFound: mismatches.length,
      walletsFrozen: mismatchedWalletIds.length,
    };
  } catch (err) {
    await supabase
      .from("wallet_reconciliation_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        wallets_checked: walletsChecked,
        details: [{ error: err instanceof Error ? err.message : String(err) }],
      })
      .eq("id", runId);
    throw err;
  }
}
