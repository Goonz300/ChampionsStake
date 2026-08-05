"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField, SubmitButton, FormBanner } from "@/components/auth/form-elements";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error?.message ?? "Something went wrong.");
        return;
      }

      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <FormBanner
          kind="success"
          message="If an account exists for that email, a reset link is on its way."
        />
        <Link href="/login" className="font-exo text-vv-neon-green block text-center text-sm">
          Back to login
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot password" subtitle="We'll email you a reset link.">
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
        <SubmitButton loading={loading}>Send reset link</SubmitButton>
      </form>
      <Link href="/login" className="font-exo text-vv-neon-green mt-4 block text-center text-sm">
        Back to login
      </Link>
    </AuthCard>
  );
}
