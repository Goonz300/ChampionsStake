/**
 * Typed, validated environment loader.
 *
 * Per the "Server Authority / Zero Trust Client" principle (Business Rules §1),
 * the server must never boot into a state where it silently falls back to an
 * undefined secret — a missing secret must fail loudly at first use rather
 * than allow a degraded code path to run silently.
 *
 * `clientEnv` values are safe to bundle into client JS (NEXT_PUBLIC_ prefix).
 * `serverEnv` values must never be imported from a "use client" file — importing
 * this module from client code will throw during the server-only checks below.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
}

export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  NEXT_PUBLIC_APP_URL: required(
    "NEXT_PUBLIC_APP_URL",
    process.env.NEXT_PUBLIC_APP_URL,
  ),
} as const;

/**
 * Server-only environment. Importing this from a "use client" component is a
 * bug — Next.js will fail the build if a server-only secret is referenced
 * from client code, but this explicit typeof check gives a clearer error
 * message earlier in development.
 *
 * PROD-001 fix: this previously also required STRIPE_SECRET_KEY/
 * STRIPE_WEBHOOK_SECRET/STRIPE_CONNECT_CLIENT_ID — leftover from the
 * Architecture Document's original anticipated provider. PAYMENT-001
 * actually implemented Paystack, entirely inside Deno Edge Functions
 * (supabase/functions/_payment/providers/paystack.ts), which reads its own
 * PAYSTACK_SECRET_KEY directly via Deno.env.get() and never touches this
 * Next.js-side loader at all. Because serverEnv builds its ENTIRE object
 * eagerly on first property access (see the Proxy below), requiring those
 * three unused Stripe vars meant ANY access to serverEnv for ANY reason
 * (e.g. createServiceRoleClient() reading SUPABASE_SERVICE_ROLE_KEY) would
 * throw on a real deployment that correctly never sets them — a genuine
 * production-breaking bug, found and fixed here, not just documented.
 */
function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error(
      "serverEnv must not be imported from client-side code. " +
        "Move this import into a server component, route handler, or Edge Function.",
    );
  }

  return {
    SUPABASE_SERVICE_ROLE_KEY: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    RESEND_API_KEY: required("RESEND_API_KEY", process.env.RESEND_API_KEY),
    KYC_PROVIDER_KEY: optional(process.env.KYC_PROVIDER_KEY),
    UPSTASH_REDIS_URL: optional(process.env.UPSTASH_REDIS_URL),
    UPSTASH_REDIS_TOKEN: optional(process.env.UPSTASH_REDIS_TOKEN),
    SENTRY_DSN: optional(process.env.SENTRY_DSN),
  } as const;
}

// Lazily evaluated so that importing this module doesn't throw at module-load
// time in contexts (like this Phase 0 scaffold, or unit tests) where secrets
// genuinely aren't configured yet — the throw happens on first *use*.
let cached: ReturnType<typeof getServerEnv> | undefined;
export const serverEnv = new Proxy({} as ReturnType<typeof getServerEnv>, {
  get(_target, prop: string) {
    if (!cached) {
      cached = getServerEnv();
    }
    return cached[prop as keyof typeof cached];
  },
});
