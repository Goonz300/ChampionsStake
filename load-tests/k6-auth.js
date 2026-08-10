// load-tests/k6-auth.js
// Scenario: mass login (brief's "100k users" / "mass login" targets).
//
// Measures Supabase Auth's own token endpoint (GoTrue) under sustained
// concurrent login load -- this is infrastructure this platform doesn't
// own (Supabase-managed), but its latency directly gates every other
// scenario's first step, so it's worth measuring in isolation.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { ANON_KEY, pickAccount } from "./lib/common.js";

const loginErrors = new Rate("login_errors");
const loginDuration = new Trend("login_duration", true);

const SUPABASE_AUTH_URL = __ENV.SUPABASE_AUTH_URL ||
  (__ENV.BASE_URL || "http://localhost:54321").replace(
    "/functions/v1",
    "",
  ) + "/auth/v1";

export const options = {
  scenarios: {
    mass_login: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 2000 }, // ramp to 2000 concurrent logins
        { duration: "5m", target: 2000 }, // sustain -- extrapolate to 100k
        // total attempts via --duration/iteration count, not raw VU count;
        // 100k SIMULTANEOUS connections is a connection-count claim better
        // measured by k6-realtime-websockets.js, not by VUs alone here.
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    login_errors: ["rate<0.01"], // fewer than 1% failed logins
    login_duration: ["p(95)<800", "p(99)<2000"], // ms
  },
};

export default function () {
  const account = pickAccount();
  if (!account.email || !account.password) {
    throw new Error(
      "TEST_ACCOUNT_POOL entries need {email, password} for this scenario (not pre-issued JWTs, since login IS what's being measured).",
    );
  }

  const start = Date.now();
  const res = http.post(
    `${SUPABASE_AUTH_URL}/token?grant_type=password`,
    JSON.stringify({ email: account.email, password: account.password }),
    { headers: { "Content-Type": "application/json", "apikey": ANON_KEY } },
  );
  loginDuration.add(Date.now() - start);

  const ok = check(res, {
    "login succeeded": (r) => r.status === 200,
    "returned an access token": (r) => {
      try {
        return Boolean(JSON.parse(r.body).access_token);
      } catch {
        return false;
      }
    },
  });
  loginErrors.add(!ok);

  sleep(Math.random() * 2); // stagger, not a synchronized thundering herd
}
