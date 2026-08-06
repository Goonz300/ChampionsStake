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
        <div className="bg-vv-divider h-10 rounded" />
        <div className="bg-vv-divider h-10 rounded" />
        <div className="bg-vv-divider h-10 rounded" />
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

  // Phase 3C independent-review finding: this page previously ignored
  // `mfa_required` entirely and treated ANY non-error /api/auth/login
  // response as a completed login -- for an MFA-enrolled account there was
  // no way to actually finish signing in through the UI at all, and
  // (before middleware.ts's matching fix) nothing stopped a plain password
  // from reaching protected pages regardless. `mfaFactorId` non-null means
  // the credentials were correct but a second factor is still required.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  async function finishLogin(tokens: { access_token: string; refresh_token: string }) {
    // The route handler already set the session cookies server-side; sync
    // the browser client's in-memory state too so useAuth() updates
    // immediately without waiting for the next full page load.
    const supabase = createClient();
    await supabase.auth.setSession(tokens);

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
  }

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

      if (json.data.mfa_required) {
        setMfaFactorId(json.data.factor_id);
        return;
      }

      await finishLogin({
        access_token: json.data.access_token,
        refresh_token: json.data.refresh_token,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = useRecoveryCode
        ? await fetch("/api/auth/mfa/recovery-codes/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: mfaCode }),
          })
        : await fetch("/api/auth/mfa/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ factorId: mfaFactorId, code: mfaCode, context: "login" }),
          });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error?.message ?? "Invalid code. Please try again.");
        return;
      }

      await finishLogin({
        access_token: json.data.access_token,
        refresh_token: json.data.refresh_token,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (mfaFactorId) {
    return (
      <AuthCard title="Verify your identity" subtitle="Enter the code from your authenticator app.">
        {error && <FormBanner kind="error" message={error} />}
        <form onSubmit={handleMfaSubmit} noValidate>
          <FormField
            label={useRecoveryCode ? "Recovery code" : "6-digit code"}
            id="mfa-code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            autoComplete="one-time-code"
            required
            autoFocus
          />
          <SubmitButton loading={loading}>Verify</SubmitButton>
        </form>
        <p className="font-exo text-vv-text-secondary mt-4 text-center text-sm">
          <button
            type="button"
            className="text-vv-neon-green"
            onClick={() => {
              setUseRecoveryCode((v) => !v);
              setMfaCode("");
              setError(null);
            }}
          >
            {useRecoveryCode ? "Use your authenticator app instead" : "Use a recovery code instead"}
          </button>
        </p>
      </AuthCard>
    );
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
        <label className="font-exo text-vv-text-secondary mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="border-vv-divider h-4 w-4 rounded"
          />
          Remember me
        </label>
        <SubmitButton loading={loading}>Log in</SubmitButton>
      </form>

      <div className="text-vv-text-tertiary my-4 flex items-center gap-3 text-xs">
        <div className="bg-vv-divider h-px flex-1" />
        or continue with
        <div className="bg-vv-divider h-px flex-1" />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => signInWithOAuth("google", redirectTo)}
          className="font-exo border-vv-divider hover:border-vv-neon-green flex-1 rounded border py-2 text-sm text-white"
        >
          Google
        </button>
        <button
          type="button"
          onClick={() => signInWithOAuth("discord", redirectTo)}
          className="font-exo border-vv-divider hover:border-vv-neon-green flex-1 rounded border py-2 text-sm text-white"
        >
          Discord
        </button>
      </div>

      <p className="font-exo text-vv-text-secondary mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-vv-neon-green">
          Forgot password?
        </Link>
      </p>
      <p className="font-exo text-vv-text-secondary mt-2 text-center text-sm">
        New here?{" "}
        <Link href="/register" className="text-vv-neon-green">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
