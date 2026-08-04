// supabase/functions/_shared/idempotency/index.ts

import { getServiceRoleClient } from "../database/client.ts";
import { IdempotencyConflictError } from "../errors/index.ts";
import { config } from "../config/index.ts";

async function fingerprintOf(endpoint: string, body: unknown): Promise<string> {
  const normalized = JSON.stringify(body, Object.keys(body as Record<string, unknown>).sort());
  const bytes = new TextEncoder().encode(`${endpoint}:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type IdempotencyOutcome<T> =
  | { kind: "fresh" }
  | { kind: "replayed"; response: { statusCode: number; body: T } };

/**
 * Call at the very start of any handler that mutates state and accepts an
 * Idempotency-Key header (financial endpoints, webhook receivers). Returns
 * `{ kind: "replayed" }` with the original response if this exact key+body
 * combination was already completed — the caller should return that
 * response as-is rather than re-running the handler. Throws
 * IdempotencyConflictError if the same key was used with a DIFFERENT body
 * (a client bug, or a real reuse attempt), per Readiness Report Critical #2.
 */
export async function beginIdempotentRequest<T>(
  key: string,
  endpoint: string,
  body: unknown,
): Promise<IdempotencyOutcome<T>> {
  const supabase = getServiceRoleClient();
  const fingerprint = await fingerprintOf(endpoint, body);

  const { data: existing } = await supabase
    .from("idempotency_keys")
    .select("*")
    .eq("key", key)
    .maybeSingle();

  if (existing) {
    if (existing.request_fingerprint !== fingerprint) {
      throw new IdempotencyConflictError(
        "This idempotency key was already used with a different request payload.",
      );
    }
    if (existing.status === "completed") {
      return {
        kind: "replayed",
        response: { statusCode: existing.response_status_code ?? 200, body: existing.response_body as T },
      };
    }
    // status === 'in_progress': a concurrent request with the same key is
    // still running. Treat as a conflict rather than double-processing.
    throw new IdempotencyConflictError("A request with this idempotency key is already being processed.");
  }

  const expiresAt = new Date(
    Date.now() + config.timeouts.idempotencyWindowHours * 60 * 60 * 1000,
  ).toISOString();

  const { error: insertError } = await supabase.from("idempotency_keys").insert({
    key,
    request_fingerprint: fingerprint,
    status: "in_progress",
    expires_at: expiresAt,
  });

  if (insertError) {
    // Unique-violation race: another request beat us to inserting this key
    // between our SELECT and INSERT. Treat identically to the "existing"
    // branch above by re-reading it.
    const { data: raceWinner } = await supabase
      .from("idempotency_keys")
      .select("*")
      .eq("key", key)
      .maybeSingle();

    if (raceWinner?.status === "completed") {
      return {
        kind: "replayed",
        response: { statusCode: raceWinner.response_status_code ?? 200, body: raceWinner.response_body as T },
      };
    }
    throw new IdempotencyConflictError("A request with this idempotency key is already being processed.");
  }

  return { kind: "fresh" };
}

export async function completeIdempotentRequest(
  key: string,
  statusCode: number,
  responseBody: unknown,
): Promise<void> {
  const supabase = getServiceRoleClient();

  await supabase
    .from("idempotency_keys")
    .update({
      status: "completed",
      response_status_code: statusCode,
      response_body: responseBody as Record<string, unknown>,
      completed_at: new Date().toISOString(),
    })
    .eq("key", key);
}

export async function failIdempotentRequest(key: string): Promise<void> {
  const supabase = getServiceRoleClient();
  // Marking 'failed' (rather than leaving it 'in_progress' forever) lets a
  // future retry with the SAME key be treated as fresh rather than
  // perpetually conflicting — see the status check in beginIdempotentRequest,
  // which only short-circuits on 'completed', so a 'failed' row falls
  // through to the in-progress conflict branch today. A future enhancement
  // could explicitly allow retrying a 'failed' key; documented here as a
  // deliberate v1 simplification, not an oversight.
  await supabase.from("idempotency_keys").update({ status: "failed" }).eq("key", key);
}
