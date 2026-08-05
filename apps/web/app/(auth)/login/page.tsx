"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField, SubmitButton, FormBanner } from "@/components/auth/form-elements";
import { createClient } from "@/lib/supabase/client";
import { signInWithOAuth } from "@/lib/auth/oauth";
import { getSafeRedirectPath } from "@/lib/auth/safe-redirect";

/**
 * useSearchParams() reads the current URL's query string, which does not
 * exist yet at static-generation time — there is no "current request" when
 * Next.js prerenders this page ahead of time. The App Router's rule is that
 * the nearest ancestor of any useSearchParams() call must be wrapped in
 * <Suspense>, so Next can statically prerender a fallback shell for this
 * route and defer the part that genuinely needs the URL to the client,
 * rather than needing the entire page to become dynamic. Without that
 * boundary, prerendering fails outright instead of silently falling back —
 * this is documented at https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout.
 *
 * The fix is a component split, not a config flag: LoginPage (the actual
 * page export) does nothing but render the Suspense boundary; LoginForm
 * (below) is the original component, unchanged, with the one useSearchParams()
 * call now sitting inside that boundary instead of at the page's root.
 * `dynamic = "force-dynamic"` was deliberately not used — it would work,
 * but it forces this page to skip static generation entirely on every
 * request, which is a strictly worse outcome than the officially
 * recommended Suspense split for a page like this that has no other reason
 * to be fully dynamic.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFormFallback />}>
      <LoginForm />
    </Suspense>
  );
}

/** Static, hook-free fallback shown while the real form (which needs
 * useSearchParams()) is resolved on the client — kept intentionally close
 * to the real form's shape so there's no layout shift on hydration. */
function LoginFormFallback() {
  return (
    <AuthCard title="Log in" subtitle="Welcome back to ChampionsStake.">
      <div className="animate-pulse space-y-4">
        <div className="h-10 rounded bg-vv-divider" />
        <div className="h-10 rounded bg-vv-divider" />
        <div className="h-10 rounded bg-vv-divider" />
      </div>
    </AuthCard>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = getSafeRedirectPath(searchParams.get("redirect_to"), "/dashboard");
  const infoMessage =
    searchParams.get("message") === "already_verified"
      ? "That link was already used — your email is verified. Log in below."
      : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error?.message ?? "Login failed.");
        return;
      }

      // The route handler already set the session cookies server-side; sync
      // the browser client's in-memory state too so useAuth() updates
      // immediately without waiting for the next full page load.
      const supabase = createClient();
      await supabase.auth.setSession({
        access_token: json.data.access_token,
        refresh_token: json.data.refresh_token,
      });

      // Cast to router.push's OWN declared parameter type (derived via
      // Parameters<>, not the public `Route` type) — verified via a
      // standalone tsc harness that `Route` (unparameterized, as exported
      // by `next`) can collapse to plain `string` and fail to satisfy the
      // router's real constraint, while deriving the target type directly
      // from the function itself cannot mismatch, whatever that
      // constraint's exact shape turns out to be. See
      // lib/auth/safe-redirect.ts for the full reasoning and verification.
      router.push(redirectTo as Parameters<typeof router.push>[0]);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Log in" subtitle="Welcome back to ChampionsStake.">
      {infoMessage && <FormBanner kind="success" message={infoMessage} />}
      {error && <FormBanner kind="error" message={error} />}
      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="Email"
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <FormField
          label="Password"
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <label className="font-exo mb-4 flex items-center gap-2 text-sm text-vv-text-secondary">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-vv-divider"
          />
          Remember me
        </label>
        <SubmitButton loading={loading}>Log in</SubmitButton>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-vv-text-tertiary">
        <div className="h-px flex-1 bg-vv-divider" />
        or continue with
        <div className="h-px flex-1 bg-vv-divider" />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => signInWithOAuth("google", redirectTo)}
          className="font-exo flex-1 rounded border border-vv-divider py-2 text-sm text-white hover:border-vv-neon-green"
        >
          Google
        </button>
        <button
          type="button"
          onClick={() => signInWithOAuth("discord", redirectTo)}
          className="font-exo flex-1 rounded border border-vv-divider py-2 text-sm text-white hover:border-vv-neon-green"
        >
          Discord
        </button>
      </div>

      <p className="font-exo mt-4 text-center text-sm text-vv-text-secondary">
        <Link href="/forgot-password" className="text-vv-neon-green">
          Forgot password?
        </Link>
      </p>
      <p className="font-exo mt-2 text-center text-sm text-vv-text-secondary">
        New here?{" "}
        <Link href="/register" className="text-vv-neon-green">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
