import { randomBytes, createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

const CODE_COUNT = 10;

/**
 * mfa_recovery_codes (migration 0073) is hash-only storage -- the plaintext
 * code exists only transiently, generated here and returned to the caller
 * exactly once. This hash function is intentionally the same primitive
 * (SHA-256) used throughout this codebase for non-password secrets (device
 * fingerprints, session refresh tokens) -- recovery codes are high-entropy
 * random tokens, not user-chosen passwords, so a fast hash is appropriate
 * here (unlike a password, there is no realistic dictionary/brute-force
 * attack surface against a 2^40-entropy random value an attacker doesn't
 * already possess).
 */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Generates one recovery code: 5 random bytes (40 bits of entropy) as hex,
 * formatted XXXXX-XXXXX for readability. Uses Node's CSPRNG (crypto.
 * randomBytes), never Math.random().
 */
function generateOneCode(): string {
  const hex = randomBytes(5).toString("hex");
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}`;
}

export interface RecoveryCodesResult {
  codes: string[];
  error: Error | null;
}

/**
 * Generates a fresh batch of 10 recovery codes for a user, deleting any
 * existing unused codes first -- this function serves both "generate for
 * the first time" (nothing to delete, a no-op) and "regenerate" (Milestone
 * 3) uniformly, rather than two near-duplicate functions. Old codes are
 * hard-deleted, not soft-invalidated, so there's no ambiguity between
 * "consumed via login" and "retired via regeneration" sharing the same
 * used_at semantics.
 *
 * Returns the plaintext codes -- the ONLY time they ever exist outside the
 * user's own authenticator/password manager. Only the SHA-256 hash is
 * persisted. Caller is responsible for audit-logging the event (generation
 * vs. regeneration are distinct, security-relevant events with different
 * names) and for requiring aal2 before calling this for an already-enrolled
 * user (Milestone 3's "re-authentication" requirement) -- this function
 * itself has no opinion on when it's appropriate to call.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<RecoveryCodesResult> {
  const supabase = createServiceRoleClient();

  const { error: deleteError } = await supabase
    .from("mfa_recovery_codes")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    return { codes: [], error: deleteError };
  }

  const codes = Array.from({ length: CODE_COUNT }, generateOneCode);
  const rows = codes.map((code) => ({ user_id: userId, code_hash: hashCode(code) }));

  const { error: insertError } = await supabase.from("mfa_recovery_codes").insert(rows);

  if (insertError) {
    return { codes: [], error: insertError };
  }

  return { codes, error: null };
}

/**
 * Atomically consumes one recovery code, if it exists, belongs to userId,
 * and hasn't been used yet -- a single UPDATE ... WHERE used_at IS NULL
 * RETURNING statement, not a SELECT-then-UPDATE, so two concurrent
 * requests holding the same leaked code cannot both succeed (Postgres's
 * own row-level locking on the UPDATE guarantees at most one caller ever
 * receives a non-empty result for a given code_hash).
 *
 * Returns success:false for both "wrong code" and "already used" --
 * deliberately the same generic outcome for both, so a caller can't use
 * this endpoint to enumerate which of a guessed code's states is true.
 */
export async function consumeRecoveryCode(
  userId: string,
  code: string,
): Promise<{ success: boolean; error: Error | null }> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("code_hash", hashCode(code))
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, error };
  }

  return { success: data !== null, error: null };
}

/**
 * Counts a user's remaining (unused) recovery codes, for the Security
 * Settings dashboard's "N codes remaining" display -- never returns the
 * codes or their hashes, only a count.
 */
export async function countUnusedRecoveryCodes(
  userId: string,
): Promise<{ count: number; error: Error | null }> {
  const supabase = createServiceRoleClient();

  const { count, error } = await supabase
    .from("mfa_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("used_at", null);

  return { count: count ?? 0, error };
}

/**
 * Deletes all of a user's recovery codes outright -- used only when MFA
 * itself is disabled (Milestone 3): with no MFA factor enrolled, recovery
 * codes have nothing left to be a fallback for, so they should not persist
 * as stale, unusable secrets.
 */
export async function deleteAllRecoveryCodes(userId: string): Promise<{ error: Error | null }> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("mfa_recovery_codes").delete().eq("user_id", userId);

  return { error };
}
