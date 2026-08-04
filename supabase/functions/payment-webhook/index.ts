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

Deno.serve(async (req: Request) => {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    const result = await processPaymentWebhook(rawBody, signature);

    return successResponse(result);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: { code: "VALIDATION_ERROR", message: err instanceof Error ? err.message : "Webhook processing failed." },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
});
