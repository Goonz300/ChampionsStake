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
    // How many reverse-proxy hops between the real client and this function
    // are trusted to have correctly appended to X-Forwarded-For (e.g. 1 for
    // a single CDN/edge hop in front of Supabase). Client-IP extraction
    // (security/client-ip.ts) reads the Nth-from-the-end entry rather than
    // the first entry, since the first entry is client-supplied and trivially
    // spoofable by anyone who can reach the origin directly — "never trust
    // X-Forwarded-For blindly." Cloudflare's CF-Connecting-IP header, when
    // present, is preferred over X-Forwarded-For entirely and this hop count
    // does not apply to it.
    trustedProxyHops: Number(optionalEnv("EDGE_TRUSTED_PROXY_HOPS", "1")),
  },
  // Enterprise rate limiting / attack mitigation (Phase 5). Upstash Redis is
  // the distributed backend security/rate-limit.ts prefers when configured;
  // reading the env vars here (instead of via raw Deno.env.get inside
  // rate-limit.ts, which is what happened before this phase) restores this
  // file's own single-source-of-truth rule for environment variable names.
  redis: {
    get url() {
      return optionalEnv("UPSTASH_REDIS_URL", "");
    },
    get token() {
      return optionalEnv("UPSTASH_REDIS_TOKEN", "");
    },
    get isConfigured(): boolean {
      return this.url !== "" && this.token !== "";
    },
  },
  captcha: {
    // Provider-agnostic: only Turnstile's siteverify is actually implemented
    // (captcha/index.ts) — hCaptcha/reCAPTCHA Enterprise are architecture-
    // ready via the same interface but not wired to a live verify call,
    // matching this project's established honest-scoping pattern (e.g. push
    // notification providers in Phase 4).
    provider: optionalEnv("CAPTCHA_PROVIDER", "turnstile"),
    get secretKey() {
      return optionalEnv("CAPTCHA_SECRET_KEY", "");
    },
    get isConfigured(): boolean {
      return this.secretKey !== "";
    },
    // Number of recent failed attempts (login/MFA/etc.) after which a CAPTCHA
    // challenge is required before the next attempt is accepted. CAPTCHA is
    // deliberately never required by default — only after this threshold.
    triggerAfterFailures: Number(
      optionalEnv("CAPTCHA_TRIGGER_AFTER_FAILURES", "3"),
    ),
  },
  lockout: {
    // Account lockout (distinct from the rolling rate-limit window): once
    // `failuresToLock` failures land within the existing rate-limit window,
    // the account is locked for `initialLockoutMinutes`, doubling on each
    // repeated lockout up to `maxLockoutMinutes`.
    failuresToLock: Number(optionalEnv("LOCKOUT_FAILURES_TO_LOCK", "5")),
    initialLockoutMinutes: Number(
      optionalEnv("LOCKOUT_INITIAL_MINUTES", "15"),
    ),
    maxLockoutMinutes: Number(optionalEnv("LOCKOUT_MAX_MINUTES", "1440")),
  },
  progressiveDelay: {
    // Comma-separated seconds of delay applied before processing an attempt,
    // indexed by the caller's recent-failure count (0 failures -> steps[0]).
    stepsSeconds: optionalEnv("PROGRESSIVE_DELAY_STEPS_SECONDS", "0,2,5,15,30")
      .split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
  },
  fraud: {
    // Velocity-detection thresholds feeding fraud_flags (velocity.ts).
    // All windows in seconds, all counts are "more than N in the window."
    withdrawalVelocity: {
      windowSeconds: Number(
        optionalEnv("FRAUD_WITHDRAWAL_VELOCITY_WINDOW_SECONDS", "60"),
      ),
      maxCount: Number(optionalEnv("FRAUD_WITHDRAWAL_VELOCITY_MAX", "3")),
    },
    challengeCreationVelocity: {
      windowSeconds: Number(
        optionalEnv("FRAUD_CHALLENGE_VELOCITY_WINDOW_SECONDS", "60"),
      ),
      maxCount: Number(optionalEnv("FRAUD_CHALLENGE_VELOCITY_MAX", "10")),
    },
    tournamentRegistrationVelocity: {
      windowSeconds: Number(
        optionalEnv("FRAUD_TOURNAMENT_VELOCITY_WINDOW_SECONDS", "60"),
      ),
      maxCount: Number(optionalEnv("FRAUD_TOURNAMENT_VELOCITY_MAX", "5")),
    },
    failedLoginVelocity: {
      windowSeconds: Number(
        optionalEnv("FRAUD_FAILED_LOGIN_VELOCITY_WINDOW_SECONDS", "900"),
      ),
      maxCount: Number(optionalEnv("FRAUD_FAILED_LOGIN_VELOCITY_MAX", "10")),
    },
    passwordResetVelocity: {
      windowSeconds: Number(
        optionalEnv("FRAUD_PASSWORD_RESET_VELOCITY_WINDOW_SECONDS", "3600"),
      ),
      maxCount: Number(optionalEnv("FRAUD_PASSWORD_RESET_VELOCITY_MAX", "5")),
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
