// supabase/functions/_shared/security/replay.ts
//
// Replay protection for signed internal/server-to-server requests (see
// signed-requests.ts). A request is considered replay-safe if its
// timestamp is within the allowed window AND its nonce hasn't been seen
// before within that window.
//
// NOTE ON STATE: Edge Functions are stateless across invocations, so nonce
// tracking cannot live in-process — it uses the `idempotency_keys` table
// (migration 0034) as a convenient existing durable store, keyed by the
// nonce itself, rather than introducing a third table. This is an
// intentional reuse, not scope creep: an unseen nonce IS an idempotency
// key by definition (first-use-wins).

import { config } from "../config/index.ts";
import { AuthenticationError } from "../errors/index.ts";
import { getServiceRoleClient } from "../database/client.ts";

export interface ReplayCheckInput {
  timestamp: number; // unix seconds, from the request's signature payload
  nonce: string; // UUID, from the request's signature payload
}

export function assertWithinReplayWindow(timestamp: number): void {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const age = Math.abs(nowSeconds - timestamp);

  if (age > config.security.replayWindowSeconds) {
    throw new AuthenticationError(
      `Request timestamp is outside the allowed ${config.security.replayWindowSeconds}s replay window.`,
    );
  }
}

export async function assertNonceNotReused(nonce: string): Promise<void> {
  const supabase = getServiceRoleClient();

  const { error } = await supabase.from("idempotency_keys").insert({
    key: nonce,
    request_fingerprint: "replay-nonce", // distinguishes replay-nonce rows from true idempotency-key rows at a glance
    status: "completed",
  });

  if (error) {
    // Unique-violation on the primary key means this nonce was already used.
    throw new AuthenticationError(
      "This request has already been processed (replay detected).",
    );
  }
}

export async function assertNotReplayed(
  input: ReplayCheckInput,
): Promise<void> {
  assertWithinReplayWindow(input.timestamp);
  await assertNonceNotReused(input.nonce);
}
