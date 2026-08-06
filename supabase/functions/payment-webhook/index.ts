// supabase/functions/payment-webhook/index.ts
//
// No JWT auth at all — Paystack calls this directly with no user session.
// The ONLY authentication is the HMAC signature check inside
// processPaymentWebhook, which is why this function reads the RAW request
// body as text (never parses it as JSON first) — an HMAC is computed over
// the exact bytes Paystack sent; re-serializing a parsed object would
// almost always produce a different byte string and falsely fail
// verification, or worse, be tempting to skip "for convenience" in a way
// that weakens the actual security boundary.

import { successResponse } from "../_shared/response/index.ts";
import { processPaymentWebhook } from "../_payment/webhook-service.ts";
import { getClientIp } from "../_shared/security/client-ip.ts";
import { enforceRateLimit } from "../_shared/security/rate-limit.ts";
import { RateLimitError } from "../_shared/errors/index.ts";

// Layer 10 (Webhook Security): the ONLY Edge Function in this codebase that
// doesn't go through withEdgeFunction (see the header comment above) --
// which also means it never got the rate-limit floor every other function
// picked up from the compose.ts change earlier in this phase. Rate limited
// by IP directly (Paystack calls from a small, stable set of source IPs;
// generous enough not to throttle genuine webhook bursts, tight enough that
// a scripted flood of forged requests can't force unlimited HMAC/DB work).
// HMAC signature verification (constant-time), idempotency via
// processed_payment_webhook_events' unique constraint, and re-verification
// against Paystack's own API before completing a deposit/withdrawal are all
// pre-existing (_payment/webhook-service.ts, _payment/providers/paystack.ts)
// -- audited, not duplicated, here.
Deno.serve(async (req: Request) => {
  try {
    const ip = getClientIp(req) ?? "unknown";
    await enforceRateLimit({
      key: `payment-webhook:ip:${ip}`,
      windowSeconds: 60,
      maxRequests: 120,
    });

    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    const result = await processPaymentWebhook(rawBody, signature);

    return successResponse(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(
        JSON.stringify({ error: { code: err.code, message: err.message } }),
        {
          status: err.httpStatus,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(err.retryAfterSeconds),
          },
        },
      );
    }
    return new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: err instanceof Error
            ? err.message
            : "Webhook processing failed.",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
});
