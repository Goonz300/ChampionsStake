// supabase/functions/_shared/transactions/index.ts
//
// DESIGN NOTE: the Supabase JS client (database/client.ts) talks to
// PostgREST, which cannot express a client-orchestrated multi-statement
// transaction — each call is its own request/transaction. Genuine
// transactions here use a direct Postgres connection (via the `postgres`
// Deno-compatible driver) against Supavisor's *transaction* pooler, with a
// deliberately tiny pool size (config.database.maxPoolSize, default 1) —
// serverless Edge Functions that each open unbounded connections against
// the pooler is a well-known way to exhaust it, so this framework defaults
// to the smallest pool that still works and documents why, rather than
// leaving future functions to discover the problem in production.
//
// Prefer, where possible, pushing multi-step logic into a single Postgres
// function (RPC) instead — a Postgres function is always atomic per call
// with zero extra connection management. withTransaction below exists for
// the cases that genuinely need several distinct statements orchestrated
// from Edge Function code (e.g. coordinating a Storage API call with a
// metadata write, which cannot be expressed inside a Postgres function at
// all since Postgres cannot call the Storage API itself).

import postgres from "npm:postgres@3";
import { config } from "../config/index.ts";
import { logger } from "../logger/index.ts";

type Sql = ReturnType<typeof postgres>;

let cachedSql: Sql | null = null;

function getSqlClient(): Sql {
  if (!cachedSql) {
    cachedSql = postgres(config.database.url, {
      max: config.database.maxPoolSize,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return cachedSql;
}

/**
 * Runs `fn` inside a real Postgres transaction (BEGIN/COMMIT/ROLLBACK).
 * Any thrown error automatically rolls back, per the `postgres` driver's
 * `sql.begin()` semantics.
 */
export async function withTransaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = getSqlClient();
  return sql.begin(async (txSql) => fn(txSql as unknown as Sql));
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Only retry errors this predicate returns true for (default: retry everything). */
  shouldRetry?: (err: unknown) => boolean;
}

function isRetryableByDefault(err: unknown): boolean {
  // Conservative default: retry connection/timeout-shaped errors, not
  // business-logic errors (a ValidationError retried 3 times is still
  // wrong 3 times, just slower to fail).
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    message.includes("timeout") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("57p01") // Postgres: admin shutdown
  );
}

/**
 * Retries `fn` with exponential backoff. Used for transient
 * infrastructure failures, never for retrying a request whose result
 * already had a side effect without idempotency protection — combine with
 * idempotency/index.ts for anything that mutates state.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? config.retries.defaultMaxAttempts;
  const baseDelayMs = options.baseDelayMs ?? config.retries.baseDelayMs;
  const shouldRetry = options.shouldRetry ?? isRetryableByDefault;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !shouldRetry(err)) {
        throw err;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(`Retry attempt ${attempt}/${maxAttempts} after error, waiting ${delay}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
