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
    // Upstash REST API: INCR then EXPIRE (set only on first increment via NX-like check).
    const incrRes = await fetch(`${this.url}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const incrJson = await incrRes.json();
    const count = Number(incrJson.result ?? 0);

    if (count === 1) {
      await fetch(`${this.url}/expire/${encodeURIComponent(key)}/${windowSeconds}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
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

function getBackend(): RateLimitBackend {
  const upstashUrl = Deno.env.get("UPSTASH_REDIS_URL");
  const upstashToken = Deno.env.get("UPSTASH_REDIS_TOKEN");

  if (upstashUrl && upstashToken) {
    return new UpstashBackend(upstashUrl, upstashToken);
  }

  console.warn(
    "UPSTASH_REDIS_URL/UPSTASH_REDIS_TOKEN not configured — using the Postgres fallback rate-limit backend. " +
      "This is fine for local development but not recommended for production high-frequency endpoints (Architecture §7).",
  );
  return new PostgresFallbackBackend();
}

export async function enforceRateLimit(options: RateLimitOptions): Promise<void> {
  const windowSeconds = options.windowSeconds ?? config.rateLimit.defaultWindowSeconds;
  const maxRequests = options.maxRequests ?? config.rateLimit.defaultMaxRequests;

  const backend = getBackend();
  const count = await backend.increment(options.key, windowSeconds);

  if (count > maxRequests) {
    throw new RateLimitError(
      `Rate limit exceeded for "${options.key}".`,
      windowSeconds,
      { limit: maxRequests, windowSeconds },
    );
  }
}
