// load-tests/k6-webhooks.js
// Scenario: 100 webhooks/sec (payment provider callback throughput).
//
// Signs each payload with a real HMAC-SHA512 (matching
// _payment/providers/paystack.ts's verifyWebhookSignature exactly) using
// a staging-only webhook secret -- never point this at a real provider
// secret or a production endpoint.

import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";
import crypto from "k6/crypto";
import { BASE_URL } from "./lib/common.js";

const webhookErrors = new Rate("webhook_errors");
const webhookDuration = new Trend("webhook_duration", true);

const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET;

export const options = {
  scenarios: {
    webhook_throughput: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    webhook_errors: ["rate<0.01"],
    webhook_duration: ["p(95)<500", "p(99)<1000"], // signature verify +
    // idempotent insert should be fast -- this is the endpoint most
    // sensitive to a slow signature-check implementation
  },
};

function randomReference() {
  // k6's JS runtime doesn't expose Node's crypto.randomBytes; a simple
  // random-suffix generator is sufficient here since this only needs to
  // be unique per request, not cryptographically random.
  return `loadtest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function signedPayload() {
  const reference = randomReference();
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      status: "success",
      amount: 10000,
      customer: { email: "loadtest@example.invalid" },
    },
  });
  const signature = crypto.hmac("sha512", WEBHOOK_SECRET, body, "hex");
  return { body, signature };
}

export default function () {
  if (!WEBHOOK_SECRET) {
    throw new Error(
      "Set WEBHOOK_SECRET to the STAGING project's webhook secret (never production).",
    );
  }

  const { body, signature } = signedPayload();

  const start = Date.now();
  const res = http.post(`${BASE_URL}/payment-webhook`, body, {
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": signature,
    },
  });
  webhookDuration.add(Date.now() - start);

  const ok = check(res, {
    "webhook accepted": (r) => r.status === 200,
  });
  webhookErrors.add(!ok);
}
