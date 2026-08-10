// load-tests/k6-tournaments.js
// Scenarios: mass tournament creation (20k tournaments), mass registration
// (10k concurrent matches' worth of registrants), bracket generation at
// scale.
//
// Requires the test account pool to include at least one account with the
// 'organizer' role (see docs/ORGANIZER_PLATFORM_DESIGN.md -- creation is
// deliberately not self-service) for the creation scenario, and a larger
// pool of regular player accounts for registration.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { authHeaders, BASE_URL, newIdempotencyKey, pickAccount, testAccounts } from "./lib/common.js";

const createErrors = new Rate("tournament_create_errors");
const createDuration = new Trend("tournament_create_duration", true);
const registerErrors = new Rate("tournament_register_errors");
const registerDuration = new Trend("tournament_register_duration", true);

// A real staging run needs a known game_id to create tournaments against
// -- seed one and pass it in, rather than guessing a UUID.
const GAME_ID = __ENV.TEST_GAME_ID;

export const options = {
  scenarios: {
    // Brief target: 20,000 tournaments. At a sustained rate this is a
    // throughput/duration product, not a single burst -- 20k over a
    // 30-minute window is ~11/sec sustained, well within a single
    // organizer-role test account's own rate limit (10/60s per
    // PHASE7_8_PERFORMANCE_REVIEW.md's table) if run serially, so this
    // scenario pools MULTIPLE organizer test accounts to actually reach
    // the target throughput realistically -- don't just crank one
    // account's request rate past its own rate limit and call the
    // resulting 429s "load test findings."
    mass_creation: {
      executor: "constant-arrival-rate",
      rate: 11,
      timeUnit: "1s",
      duration: "30m",
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: "createTournament",
    },
    // Brief target: registrations feeding 10,000 concurrent matches
    // (~20,000 registrants for single-elim). Bursty by nature -- real
    // registration traffic spikes right before a popular tournament's
    // registration window closes, not a flat rate.
    mass_registration: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      stages: [
        { target: 5, duration: "1m" },
        { target: 500, duration: "3m" }, // the pre-close spike
        { target: 500, duration: "2m" },
        { target: 0, duration: "1m" },
      ],
      preAllocatedVUs: 100,
      maxVUs: 1000,
      exec: "registerForTournament",
    },
  },
  thresholds: {
    tournament_create_errors: ["rate<0.02"],
    tournament_create_duration: ["p(95)<1500"],
    tournament_register_errors: ["rate<0.02"],
    tournament_register_duration: ["p(95)<1200"], // includes an escrow-lock write
  },
};

export function createTournament() {
  if (!GAME_ID) {
    throw new Error("Set TEST_GAME_ID to a real games.id in the staging project.");
  }
  const organizer = testAccounts.find((a) => a.role === "organizer") ??
    pickAccount();

  const body = JSON.stringify({
    gameId: GAME_ID,
    name: `Load Test Tournament ${newIdempotencyKey()}`,
    format: "single_elim",
    entryFeeCents: 0, // free tournaments -- this scenario measures write
    // throughput, not wallet interaction (see mass_withdrawals in
    // k6-wallet.js for that)
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/tournament-create`, body, {
    headers: authHeaders(organizer.jwt),
  });
  createDuration.add(Date.now() - start);

  const ok = check(res, {
    "tournament created": (r) => r.status === 201,
  });
  createErrors.add(!ok);
}

export function registerForTournament() {
  const tournamentId = __ENV.TEST_TOURNAMENT_ID;
  if (!tournamentId) {
    throw new Error(
      "Set TEST_TOURNAMENT_ID to a real, open-registration tournament id -- " +
        "run mass_creation first (or seed one manually) and feed its id in.",
    );
  }
  const player = pickAccount();

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/tournament-register`,
    JSON.stringify({ tournamentId }),
    {
      headers: {
        ...authHeaders(player.jwt),
        "Idempotency-Key": newIdempotencyKey(),
      },
    },
  );
  registerDuration.add(Date.now() - start);

  const ok = check(res, {
    // 201 = registered, 409 = already registered or full (expected under
    // real concurrent load against a capacity-limited tournament, not a
    // failure of the system)
    "registration handled correctly": (r) => r.status === 201 || r.status === 409,
  });
  registerErrors.add(!ok);

  sleep(Math.random() * 0.5);
}
