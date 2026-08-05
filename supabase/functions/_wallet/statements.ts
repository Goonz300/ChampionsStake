// supabase/functions/_wallet/statements.ts

import {
  listTransactions,
  type TransactionHistoryFilter,
} from "./repository.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";

export interface StatementLine {
  transactionId: string;
  type: string;
  status: string;
  amountCents: number;
  createdAt: string;
  runningBalanceCents: number;
}

/**
 * Builds a running-balance statement for a wallet over a date range. The
 * running balance is computed forward from the wallet's ledger-derived
 * `available` balance at the START of the range (so it's internally
 * consistent even if the wallet has moved since), not from the CURRENT
 * cached balance walked backward — walking backward from "now" would be
 * wrong the instant a new transaction lands mid-computation.
 */
export async function generateStatement(
  walletId: string,
  fromDate: string,
  toDate: string,
): Promise<
  {
    lines: StatementLine[];
    openingBalanceCents: number;
    closingBalanceCents: number;
  }
> {
  const supabase = getServiceRoleClient();

  const { data: openingRows } = await supabase
    .from("wallet_ledger")
    .select("direction, amount_cents")
    .eq("wallet_id", walletId)
    .eq("account_type", "available")
    .lt("created_at", fromDate);

  const openingBalanceCents = (openingRows ?? []).reduce(
    (sum, row) =>
      sum + (row.direction === "credit" ? row.amount_cents : -row.amount_cents),
    0,
  );

  const filter: TransactionHistoryFilter = {
    walletId,
    fromDate,
    toDate,
    limit: 10_000,
  };
  const transactions = await listTransactions(filter);

  // listTransactions returns newest-first; a statement reads chronologically.
  const chronological = [...transactions].reverse();

  let runningBalance = openingBalanceCents;
  const lines: StatementLine[] = [];

  for (const tx of chronological) {
    const { data: legs } = await supabase
      .from("wallet_ledger")
      .select("direction, amount_cents")
      .eq("wallet_transaction_id", tx.id)
      .eq("wallet_id", walletId)
      .eq("account_type", "available");

    const netForThisWallet = (legs ?? []).reduce(
      (sum, leg) =>
        sum +
        (leg.direction === "credit" ? leg.amount_cents : -leg.amount_cents),
      0,
    );
    runningBalance += netForThisWallet;

    lines.push({
      transactionId: tx.id,
      type: tx.type,
      status: tx.status,
      amountCents: netForThisWallet,
      createdAt: tx.created_at,
      runningBalanceCents: runningBalance,
    });
  }

  return { lines, openingBalanceCents, closingBalanceCents: runningBalance };
}

/**
 * Export architecture only (per this phase's brief: "CSV export
 * architecture, PDF export architecture" — not full implementations,
 * mirroring STORE-001's image-processing extension-point pattern). The CSV
 * exporter is trivial enough to actually implement (no new dependency,
 * pure string formatting); the PDF exporter is a documented interface with
 * a not-yet-implemented body, since a real PDF library is a genuine new
 * dependency decision this phase shouldn't make unilaterally.
 */
export function statementToCsv(
  statement: {
    lines: StatementLine[];
    openingBalanceCents: number;
    closingBalanceCents: number;
  },
): string {
  const header =
    "transaction_id,type,status,amount_cents,created_at,running_balance_cents";
  const rows = statement.lines.map((l) =>
    [
      l.transactionId,
      l.type,
      l.status,
      l.amountCents,
      l.createdAt,
      l.runningBalanceCents,
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

export interface StatementPdfExporter {
  export(
    statement: {
      lines: StatementLine[];
      openingBalanceCents: number;
      closingBalanceCents: number;
    },
  ): Promise<Uint8Array>;
}

/** Not implemented — see this module's header comment. Throws clearly
 * rather than silently returning an empty/fake PDF. */
export const notImplementedPdfExporter: StatementPdfExporter = {
  async export() {
    throw new Error(
      "PDF statement export is architecture-only in this phase (WALLET-001) — no PDF library has been chosen yet. " +
        "Implement this by picking a Deno-compatible PDF library and filling in this function; the StatementPdfExporter " +
        "interface is stable so callers don't need to change when that happens.",
    );
  },
};
