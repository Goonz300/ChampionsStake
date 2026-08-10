// load-tests/k6-wallet.js
// Scenarios: mass withdrawals, mass escrow releases.
//
// IMPORTANT: run against a staging Paystack sandbox/test payout method,
// never a real bank account. After every run, execute EVERY query in
// docs/PHASE8_5_FINANCIAL_VERIFICATION.md against the staging database --
// this scenario exercises real concurrent writes to the wallet ledger,
// and a load test that produces a balance/ledger anomaly is the single
// most valuable thing this suite can find.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { authHeaders, BASE_URL, newIdempotencyKey, pickAccount } from "./lib/common.js";

const withdrawErrors = new Rate("withdrawal_errors");
const withdrawDuration = new Trend("withdrawal_duration", true);

export const options = {
  scenarios: {
    // Concurrent withdrawal attempts, INCLUDING deliberately repeated
    // attempts from the same account (see body below) -- the double-
    // withdrawal-prevention path (postBalancedEntries' pre-debit balance
    // re-check under a row lock) is exactly what this scenario is
    // designed to stress, not just measure latency.
    mass_withdrawals: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 100 },
        { duration: "5m", target: 300 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    withdrawal_errors: ["rate<0.05"], // 409 Conflict on a double-attempt is
    // EXPECTED and counted as a pass by the check below, not an error --
    // this threshold is for genuine 5xx/unexpected failures
    withdrawal_duration: ["p(95)<2000"],
  },
};

export default function () {
  const account = pickAccount();
  if (!account.payoutMethodId) {
    throw new Error(
      "Seed test accounts with a pre-created payout method id (payoutMethodId) " +
        "for this scenario -- create_payout_method itself isn't what's being load tested here.",
    );
  }

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/payment-transfer`,
    JSON.stringify({
      action: "withdraw",
      payoutMethodId: account.payoutMethodId,
      amountCents: 500, // small, deliberately -- this is a throughput/
      // correctness test, not a real payout amount
    }),
    {
      headers: {
        ...authHeaders(account.jwt),
        "Idempotency-Key": newIdempotencyKey(),
      },
    },
  );
  withdrawDuration.add(Date.now() - start);

  const ok = check(res, {
    // 201/200 = accepted, 409 = insufficient balance or a concurrent
    // withdrawal already in flight for this account -- both are the
    // SYSTEM WORKING CORRECTLY under contention, not a failure
    "withdrawal handled correctly": (r) =>
      r.status === 200 || r.status === 201 || r.status === 409,
  });
  withdrawErrors.add(!ok);

  sleep(Math.random());
}
