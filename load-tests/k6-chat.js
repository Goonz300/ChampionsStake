// load-tests/k6-chat.js
// Scenario: 5,000 concurrent chats.
//
// Requires TEST_CHALLENGE_IDS: a JSON array of challenge ids each test
// account pair can legitimately message in (chat-send authorizes via
// challenge participancy -- this scenario measures throughput, not
// whether authorization holds, so accounts must be real participants).

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { authHeaders, BASE_URL, pickAccount } from "./lib/common.js";

const chatErrors = new Rate("chat_send_errors");
const chatDuration = new Trend("chat_send_duration", true);

const CHALLENGE_IDS = JSON.parse(__ENV.TEST_CHALLENGE_IDS || "[]");

export const options = {
  scenarios: {
    concurrent_chats: {
      executor: "constant-vus",
      vus: 5000,
      duration: "10m",
    },
  },
  thresholds: {
    chat_send_errors: ["rate<0.02"],
    chat_send_duration: ["p(95)<600"],
  },
};

export default function () {
  if (CHALLENGE_IDS.length === 0) {
    throw new Error("Set TEST_CHALLENGE_IDS to a JSON array of real challenge ids.");
  }
  const account = pickAccount();
  const challengeId = CHALLENGE_IDS[Math.floor(Math.random() * CHALLENGE_IDS.length)];

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/chat-send`,
    JSON.stringify({
      challengeId,
      type: "text",
      content: `Load test message ${Date.now()}`,
    }),
    { headers: authHeaders(account.jwt) },
  );
  chatDuration.add(Date.now() - start);

  const ok = check(res, { "message sent": (r) => r.status === 201 });
  chatErrors.add(!ok);

  // A real chat isn't a tight loop -- players type at human speed.
  sleep(2 + Math.random() * 8);
}
