// supabase/functions/_shared/config/index.ts
//
// Centralized configuration for every Edge Function. Nothing in this
// framework should read Deno.env.get() directly outside this file — that
// keeps every environment-variable name and default value in exactly one
// place, so a typo in a variable name fails at the one call site that
// matters instead of silently producing `undefined` deep inside some
// middleware.

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return Deno.env.get(name) ?? fallback;
}

export const config = {
  supabase: {
    get url() {
      return requiredEnv("SUPABASE_URL");
    },
    get serviceRoleKey() {
      return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    },
    get anonKey() {
      return requiredEnv("SUPABASE_ANON_KEY");
    },
  },
  database: {
    // Direct Postgres connection (via Supavisor's transaction pooler),
    // used only by _shared/transactions for genuine multi-statement
    // transactions. Kept separate from the Supabase REST client, which
    // cannot express a client-orchestrated transaction.
    get url() {
      return requiredEnv("SUPABASE_DB_URL");
    },
    maxPoolSize: Number(optionalEnv("EDGE_DB_MAX_POOL_SIZE", "1")), // 1 per invocation — see transactions/README note
    statementTimeoutMs: Number(
      optionalEnv("EDGE_DB_STATEMENT_TIMEOUT_MS", "10000"),
    ),
  },
  timeouts: {
    defaultRequestTimeoutMs: Number(
      optionalEnv("EDGE_REQUEST_TIMEOUT_MS", "15000"),
    ),
    idempotencyWindowHours: Number(
      optionalEnv("EDGE_IDEMPOTENCY_WINDOW_HOURS", "24"),
    ),
  },
  retries: {
    defaultMaxAttempts: Number(optionalEnv("EDGE_RETRY_MAX_ATTEMPTS", "3")),
    baseDelayMs: Number(optionalEnv("EDGE_RETRY_BASE_DELAY_MS", "100")),
  },
  pagination: {
    defaultPageSize: Number(optionalEnv("EDGE_DEFAULT_PAGE_SIZE", "20")),
    maxPageSize: Number(optionalEnv("EDGE_MAX_PAGE_SIZE", "100")),
  },
  rateLimit: {
    // Defaults; individual functions may override per-endpoint via the
    // options passed to withRateLimit() (security/rate-limit.ts).
    defaultWindowSeconds: Number(
      optionalEnv("EDGE_RATE_LIMIT_WINDOW_SECONDS", "60"),
    ),
    defaultMaxRequests: Number(
      optionalEnv("EDGE_RATE_LIMIT_MAX_REQUESTS", "60"),
    ),
  },
  security: {
    get allowedOrigins() {
      return optionalEnv("EDGE_ALLOWED_ORIGINS", "").split(",").filter(Boolean);
    },
    replayWindowSeconds: Number(
      optionalEnv("EDGE_REPLAY_WINDOW_SECONDS", "300"),
    ),
    // Shared secret for scheduled (pg_cron-triggered) invocations of any
    // Edge Function that needs to run without a user JWT — STORE-001's
    // storage-cleanup uses its own STORAGE_CLEANUP_SHARED_SECRET; this is
    // the generic version for functions built on this framework going
    // forward, so every future scheduled function doesn't invent its own
    // env var name for the same concept.
    get scheduledJobSharedSecret() {
      return optionalEnv("EDGE_SCHEDULED_JOB_SHARED_SECRET", "");
    },
  },
  // Phase 4: the actual push/email sender migration 0065 explicitly
  // deferred to "a future Edge Function phase." resendApiKey is optional
  // (not requiredEnv) -- a deployment that hasn't configured it yet must
  // not crash on module load; the email worker checks for its presence
  // itself and logs/skips rather than throwing. Matches migration 0065's
  // own comment: 'resend' is the only email_provider actually wired up.
  notifications: {
    get resendApiKey() {
      return optionalEnv("RESEND_API_KEY", "");
    },
    get resendFromAddress() {
      return optionalEnv(
        "RESEND_FROM_ADDRESS",
        "notifications@championsstake.app",
      );
    },
    // Expo's push API accepts unauthenticated requests; an access token
    // only raises rate limits. Optional for the same reason as above.
    get expoAccessToken() {
      return optionalEnv("EXPO_ACCESS_TOKEN", "");
    },
  },
  environment: optionalEnv("EDGE_ENVIRONMENT", "development"),
} as const;
