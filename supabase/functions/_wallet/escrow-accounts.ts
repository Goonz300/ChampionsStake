// supabase/functions/_wallet/escrow-accounts.ts
//
// Phase 6 fix: escrow_accounts/escrow_transactions (migration 0005) were
// created for exactly this purpose -- an observability/audit mirror of
// escrow state, distinct from wallet_ledger (the actual money) -- but no
// code path ever wrote to them after row creation. lockToEscrow/
// releaseFromEscrow (transfer.ts) are the two choke points ALL escrow money
// movement passes through (challenges AND tournaments, confirmed by
// grep -- every _challenge/escrow-transition.ts and _tournament/workflow.ts
// call site funnels through one of these two functions), so this module's
// functions are called from inside those two, not scattered across every
// individual caller -- guarantees the bookkeeping can't be forgotten at a
// new call site the way it apparently was here.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import type { RelatedEntityRef } from "./types.ts";

type EscrowStatus = "locked" | "released" | "refunded" | "voided";
type EscrowTransactionAction = "lock" | "release" | "refund" | "void";
export type EscrowReleaseReason =
  | "mutual_release"
  | "moderator_decision"
  | "auto_expiry"
  | "refund_void";

interface EscrowAccountRow {
  id: string;
  totalLockedCents: number;
  status: EscrowStatus;
}

function ownerColumn(
  relatedEntity: RelatedEntityRef,
): "challenge_id" | "tournament_id" {
  return relatedEntity.table === "challenges"
    ? "challenge_id"
    : "tournament_id";
}

async function getOrCreateEscrowAccountFor(
  relatedEntity: RelatedEntityRef,
): Promise<EscrowAccountRow> {
  const supabase = getServiceRoleClient();
  const column = ownerColumn(relatedEntity);

  const { data: existing } = await supabase
    .from("escrow_accounts")
    .select("id, total_locked_cents, status")
    .eq(column, relatedEntity.id)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      totalLockedCents: existing.total_locked_cents,
      status: existing.status,
    };
  }

  const { data: created, error } = await supabase
    .from("escrow_accounts")
    .insert({
      [column]: relatedEntity.id,
      status: "locked",
      total_locked_cents: 0,
    })
    .select("id, total_locked_cents, status")
    .single();

  if (error || !created) {
    throw new Error(
      `Failed to create escrow account for ${relatedEntity.table}:${relatedEntity.id}: ${error?.message}`,
    );
  }

  return {
    id: created.id,
    totalLockedCents: created.total_locked_cents,
    status: created.status,
  };
}

async function adjustLocked(
  escrowAccountId: string,
  deltaCents: number,
): Promise<number> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("fn_adjust_escrow_locked", {
    p_escrow_account_id: escrowAccountId,
    p_delta_cents: deltaCents,
  });
  if (error) {
    throw new Error(
      `Failed to adjust escrow_accounts.total_locked_cents: ${error.message}`,
    );
  }
  return data as number;
}

/** Called from lockToEscrow (transfer.ts) after the ledger leg that moves a
 * wallet's available -> escrowed sub-balance has already committed. */
export async function recordEscrowLock(
  relatedEntity: RelatedEntityRef,
  walletTransactionId: string,
  amountCents: number,
  actorId: string | null,
): Promise<void> {
  const account = await getOrCreateEscrowAccountFor(relatedEntity);
  await adjustLocked(account.id, amountCents);

  const supabase = getServiceRoleClient();
  await supabase.from("escrow_transactions").insert({
    escrow_account_id: account.id,
    wallet_transaction_id: walletTransactionId,
    action: "lock" satisfies EscrowTransactionAction,
    amount_cents: amountCents,
    actor_id: actorId,
  });
}

const RELEASE_REASON_TO_TERMINAL_STATE: Record<
  EscrowReleaseReason,
  { status: EscrowStatus; action: EscrowTransactionAction }
> = {
  // moderator_decision covers both a payout-to-winner (moderatorResolveDispute)
  // and a void-refund-both-parties (moderatorVoidMatch) in the existing
  // challenge engine -- both already use this same releaseReason value, so
  // this mapping doesn't distinguish them either (matching, not inventing,
  // the existing business-logic taxonomy rather than second-guessing it).
  mutual_release: { status: "released", action: "release" },
  moderator_decision: { status: "released", action: "release" },
  auto_expiry: { status: "refunded", action: "refund" },
  refund_void: { status: "refunded", action: "refund" },
};

/** Called from releaseFromEscrow (transfer.ts) after the ledger legs that
 * move escrowed funds out have already committed. Multiple calls against
 * the same escrow account are expected (e.g. distributeChallengeFunds makes
 * two releaseFromEscrow calls, one per party's stake) -- the escrow_accounts
 * row only transitions out of 'locked' once total_locked_cents reaches
 * zero, i.e. once every locked leg has actually been released. */
export async function recordEscrowRelease(
  relatedEntity: RelatedEntityRef,
  walletTransactionId: string,
  amountCents: number,
  actorId: string | null,
  releaseReason: EscrowReleaseReason,
  releasedToWalletId: string,
): Promise<void> {
  const account = await getOrCreateEscrowAccountFor(relatedEntity);
  const remaining = await adjustLocked(account.id, -amountCents);
  const { status, action } = RELEASE_REASON_TO_TERMINAL_STATE[releaseReason];

  const supabase = getServiceRoleClient();
  await supabase.from("escrow_transactions").insert({
    escrow_account_id: account.id,
    wallet_transaction_id: walletTransactionId,
    action,
    amount_cents: amountCents,
    actor_id: actorId,
  });

  if (remaining <= 0) {
    await supabase
      .from("escrow_accounts")
      .update({
        status,
        release_reason: releaseReason,
        released_to_wallet_id: releasedToWalletId,
        released_at: new Date().toISOString(),
      })
      .eq("id", account.id);
  }
}
