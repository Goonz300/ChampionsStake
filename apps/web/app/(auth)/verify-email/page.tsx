"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField, SubmitButton, FormBanner } from "@/components/auth/form-elements";
import { useAuth } from "@/components/auth/AuthProvider";

export default function VerifyEmailPage() {
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email || user?.email }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error?.message ?? "Could not resend right now.");
        return;
      }

      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!authLoading && user) {
    return (
      <AuthCard title="Email verified" subtitle="You're all set.">
        <FormBanner kind="success" message="Your email has been verified." />
        <Link
          href="/dashboard"
          className="font-exo text-vv-neon-green mt-4 block text-center text-sm"
        >
          Go to dashboard
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Verify your email"
      subtitle="Click the link we sent you to activate your account."
    >
      {error && <FormBanner kind="error" message={error} />}
      {sent && <FormBanner kind="success" message="Verification email resent." />}
      <form onSubmit={handleResend} noValidate>
        <FormField
          label="Email"
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={user?.email ?? "you@example.com"}
          autoComplete="email"
        />
        <SubmitButton loading={loading}>Resend verification email</SubmitButton>
      </form>
    </AuthCard>
  );
}
