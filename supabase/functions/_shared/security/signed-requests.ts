// supabase/functions/_shared/security/signed-requests.ts
//
// Generic HMAC-SHA256 request signature verification, for internal
// service-to-service calls (e.g. pg_cron -> Edge Function, as used by
// STORE-001's storage-cleanup function) and as the template future webhook
// handlers (Stripe, KYC provider) should follow — this framework does not
// implement Stripe/KYC-specific verification itself (that's Wallet/Payment
// phase business logic), only the generic HMAC primitive they'll reuse.

import { AuthenticationError } from "../errors/index.ts";

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison -- exported (Phase 3D independent-review
 * finding) so every bearer-token/signature check in this codebase can reuse
 * the ONE timing-safe comparison already implemented here, instead of each
 * call site writing its own plain `===`/`!==` (a real, if low-severity,
 * timing-attack surface: a naive comparison short-circuits on the first
 * mismatched byte, leaking how many leading bytes of a guessed secret were
 * correct). This was previously a private helper used only by
 * verifyHmacSignature below; nothing about its behavior changes by
 * exporting it.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifyHmacSignature(
  rawBody: string,
  providedSignatureHex: string,
  secret: string,
): Promise<void> {
  const expected = await hmacSha256Hex(secret, rawBody);
  if (!timingSafeEqual(expected, providedSignatureHex)) {
    throw new AuthenticationError("Request signature verification failed.");
  }
}

export function signPayload(payload: string, secret: string): Promise<string> {
  return hmacSha256Hex(secret, payload);
}
