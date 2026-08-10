// load-tests/k6-realtime-websockets.js
// Scenario: 50,000 websocket connections (Supabase Realtime capacity).
//
// This measures something this platform doesn't control the ceiling of --
// Supabase Realtime's own connection limit is a function of the project's
// plan tier, not this codebase (see docs/PHASE8_5_REPOSITORY_AUDIT.md's
// Realtime finding and docs/PHASE8_5_SCALING_GUIDE.md). The value of this
// scenario is confirming the ACTUAL ceiling for the target plan tier
// before launch, not proving the application code can handle 50k -- there
// is no application code in the connection path at all, it's a direct
// client-to-Supabase-Realtime websocket.

import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";
import { ANON_KEY, pickAccount } from "./lib/common.js";

const connectionsOpened = new Counter("realtime_connections_opened");
const connectionErrors = new Rate("realtime_connection_errors");

const RT_URL = __ENV.REALTIME_URL ||
  "wss://your-staging-project.supabase.co/realtime/v1";

export const options = {
  scenarios: {
    connection_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5m", target: 5000 },
        { duration: "5m", target: 20000 },
        { duration: "10m", target: 50000 }, // the brief's named target --
        // expect this to find Supabase's real ceiling well before 50k on
        // most plan tiers; that ceiling IS the finding, not a failure of
        // the test
        { duration: "3m", target: 0 },
      ],
    },
  },
  thresholds: {
    realtime_connection_errors: ["rate<0.1"], // generous -- this scenario
    // exists partly TO find where the error rate climbs, not to assert
    // it never does
  },
};

export default function () {
  const account = pickAccount();
  const url = `${RT_URL}/websocket?apikey=${ANON_KEY}&vsn=1.0.0`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on("open", function () {
      connectionsOpened.add(1);
      // Subscribe to a low-traffic channel -- a real tournament's
      // spectator channel in staging, or a per-VU dummy channel if
      // subscription fan-out itself isn't what's being measured here
      // (connection COUNT is the target metric for this scenario).
      socket.send(
        JSON.stringify({
          topic: `realtime:loadtest-${__VU}`,
          event: "phx_join",
          payload: {},
          ref: "1",
        }),
      );
    });

    socket.on("error", function () {
      connectionErrors.add(1);
    });

    // Hold the connection open, matching a realistic spectator session
    // length, rather than connect-and-immediately-disconnect (which would
    // measure handshake throughput, a different question than sustained
    // connection COUNT).
    socket.setTimeout(function () {
      socket.close();
    }, 60000 + Math.random() * 30000);
  });

  check(res, { "connected": (r) => r && r.status === 101 });
  sleep(1);
}
