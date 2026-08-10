// supabase/functions/_shared/security/rate-limit.ts
//
// Sliding-window rate limiter. Backed by `idempotency_keys`-adjacent durable
// storage is the WRONG choice here (rate limiting needs fast increment-and-
// check, not a first-use-wins table) — this uses Upstash Redis when
// configured (UPSTASH_REDIS_URL, matching Architecture §7's stated choice
// for high-frequency endpoints), and falls back to a simple Postgres-backed
// counter (querying domain_events as a generic append log filtered by
// event_type='RateLimitProbe') when Upstash isn't configured, so the
// framework works in local dev without requiring Redis.
//
// This dual-backend design is deliberate: AUTH-001's login rate limiter
// already documented needing Upstash for high-frequency endpoints while
// using a Postgres fallback for login specifically. This module generalizes
// that same pattern so every future Edge Function gets it for free instead
// of re-deciding the tradeoff.

import { config } from "../config/index.ts";
import { RateLimitError } from "../errors/index.ts";
import { getServiceRoleClient } from "../database/client.ts";

export interface RateLimitOptions {
  key: string; // e.g. `login:${email}:${ip}` or `create-challenge:${userId}`
  windowSeconds?: number;
  maxRequests?: number;
}

interface RateLimitBackend {
  increment(key: string, windowSeconds: number): Promise<number>;
}

class UpstashBackend implements RateLimitBackend {
  constructor(
    private url: string,
    private token: string,
  ) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    // Phase 8.5 chaos-engineering fix: neither call had a timeout, so the
    // caller's try/catch (incrementWithFallback below) -- which correctly
    // falls back to Postgres on an Upstash ERROR -- could never trigger on
    // an Upstash HANG (up/reachable but pathologically slow, or a network
    // partition with no TCP RST). A rate limiter that can block on a
    // downstream hang defeats its own purpose: it must fail fast, not just
    // fail cleanly. AbortSignal.timeout turns a hang into the same
    // rejection path a real error already takes.
    const RATE_LIMIT_BACKEND_TIMEOUT_MS = 2000;

    // Upstash REST API: INCR then EXPIRE (set only on first increment via NX-like check).
    const incrRes = await fetch(`${this.url}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(RATE_LIMIT_BACKEND_TIMEOUT_MS),
    });
    const incrJson = await incrRes.json();
    const count = Number(incrJson.result ?? 0);

    if (count === 1) {
      await fetch(
        `${this.url}/expire/${encodeURIComponent(key)}/${windowSeconds}`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(RATE_LIMIT_BACKEND_TIMEOUT_MS),
        },
      );
    }

    return count;
  }
}

class PostgresFallbackBackend implements RateLimitBackend {
  async increment(key: string, windowSeconds: number): Promise<number> {
    const supabase = getServiceRoleClient();
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

    await supabase.from("domain_events").insert({
      event_type: "RateLimitProbe",
      payload: { key },
      emitted_by: "rate-limit-fallback",
    });

    const { count } = await supabase
      .from("domain_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "RateLimitProbe")
      .gte("created_at", since)
      .contains("payload", { key });

    return count ?? 0;
  }
}

/**
 * Hostile-review fix: this used to be a config-time-only decision (pick
 * Upstash if configured, else Postgres, once, with no runtime fallback).
 * Layer 2's global-default rate limit (compose.ts) now puts EVERY Edge
 * Function's request through this path, not just the ~17 functions that
 * had an explicit rateLimit option before this phase -- which means an
 * uncaught Upstash failure (network blip, Upstash outage) no longer
 * degrades a handful of endpoints, it 500s the entire platform's Edge
 * Function surface, since rate limiting runs before business logic in
 * every request. The brief's own Layer 2 spec explicitly asks for
 * "fallback to database if Redis unavailable" -- this now means a RUNTIME
 * fallback (Upstash actually failing this call), not just a
 * configuration-time absence of env vars.
 */
async function incrementWithFallback(
  key: string,
  windowSeconds: number,
): Promise<number> {
  if (config.redis.isConfigured) {
    try {
      return await new UpstashBackend(config.redis.url, config.redis.token)
        .increment(key, windowSeconds);
    } catch (err) {
      console.error(
        `Upstash rate-limit backend failed for key "${key}", falling back to Postgres for this check: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Falls through to the Postgres backend below rather than
      // propagating -- a transient Redis outage must not take down every
      // Edge Function request platform-wide.
    }
  } else {
    console.warn(
      "UPSTASH_REDIS_URL/UPSTASH_REDIS_TOKEN not configured — using the Postgres fallback rate-limit backend. " +
        "This is fine for local development but not recommended for production high-frequency endpoints (Architecture §7).",
    );
  }

  return await new PostgresFallbackBackend().increment(key, windowSeconds);
}

export async function enforceRateLimit(
  options: RateLimitOptions,
): Promise<void> {
  const windowSeconds = options.windowSeconds ??
    config.rateLimit.defaultWindowSeconds;
  const maxRequests = options.maxRequests ??
    config.rateLimit.defaultMaxRequests;

  const count = await incrementWithFallback(options.key, windowSeconds);

  if (count > maxRequests) {
    throw new RateLimitError(
      `Rate limit exceeded for "${options.key}".`,
      windowSeconds,
      { limit: maxRequests, windowSeconds },
    );
  }
}
