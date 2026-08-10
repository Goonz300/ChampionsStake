// load-tests/k6-notifications.js
// Scenario: 1,000,000 notifications/day.
//
// 1M/day averages to ~11.6/sec sustained, but real traffic is bursty
// (evening peak hours, a popular tournament completing and fanning out
// to hundreds of participants at once -- see
// docs/PHASE8_5_PERFORMANCE_REVIEW.md's notification-fanout finding,
// fixed this phase but still worth measuring under real load). Rather
// than generating 1M real domain_events (which would pollute a staging
// database with fake challenges/tournaments just to produce notification
// volume), this scenario directly and repeatedly invokes the
// notification-send sweep worker -- the actual unit of throughput that
// matters -- using the scheduled-job shared secret, and measures
// processed/notified counts per invocation to derive real throughput.
//
// Prerequisite: the staging database needs a realistic BACKLOG of
// unprocessed domain_events for this to measure anything meaningful --
// run the tournament/chat/wallet scenarios first (or a seed script) to
// generate real events, THEN run this scenario against the resulting
// backlog.

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import { BASE_URL } from "./lib/common.js";

const SCHEDULED_SECRET = __ENV.SCHEDULED_JOB_SECRET;

const eventsProcessedPerCall = new Trend("notification_sweep_processed");
const eventsNotifiedPerCall = new Trend("notification_sweep_notified");
const sweepDuration = new Trend("notification_sweep_duration", true);

export const options = {
  scenarios: {
    sweep_throughput: {
      executor: "constant-vus",
      vus: 5, // notification-send is a single serialized sweep per call
      // (processUnhandledEvents loops sequentially) -- concurrency here
      // measures whether overlapping sweep invocations interfere with
      // each other (they shouldn't: each event is marked processed_at
      // individually, so double-invocation is safe, just wasteful), not
      // raw single-sweep throughput
      duration: "10m",
    },
  },
  thresholds: {
    // Derived target: at 5 concurrent VUs hitting this every ~2s, sustained
    // throughput needs to clear ~23 events/sec (2x the 11.6/sec average,
    // covering realistic peak-hour multiplier) for the backlog not to grow
    // unboundedly.
    notification_sweep_duration: ["p(95)<5000"],
  },
};

export default function () {
  if (!SCHEDULED_SECRET) {
    throw new Error(
      "Set SCHEDULED_JOB_SECRET to the staging project's scheduled-job shared secret.",
    );
  }

  const start = Date.now();
  const res = http.post(`${BASE_URL}/notification-send`, null, {
    headers: { "Authorization": `Bearer ${SCHEDULED_SECRET}` },
  });
  sweepDuration.add(Date.now() - start);

  const ok = check(res, { "sweep succeeded": (r) => r.status === 200 });
  if (ok) {
    try {
      const body = JSON.parse(res.body);
      eventsProcessedPerCall.add(body.data?.processed ?? 0);
      eventsNotifiedPerCall.add(body.data?.notified ?? 0);
    } catch {
      // response shape unexpected -- surfaced via the check above already
    }
  }

  sleep(2);
}
