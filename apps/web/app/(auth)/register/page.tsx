"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField, SubmitButton, FormBanner } from "@/components/auth/form-elements";
import { registerSchema } from "@/lib/auth/validation";

export default function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = registerSchema.safeParse({ displayName, email, password });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errs[String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error?.message ?? "Registration failed.");
        return;
      }

      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <AuthCard title="Check your email" subtitle="One more step to get into the arena.">
        <FormBanner
          kind="success"
          message="We've sent a verification link to your email. Click it to activate your account."
        />
        <Link href="/login" className="font-exo block text-center text-sm text-vv-neon-green">
          Back to login
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="Compete. Stake. Win.">
      {error && <FormBanner kind="error" message={error} />}
      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="Display name"
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={fieldErrors.displayName}
          autoComplete="nickname"
          required
        />
        <FormField
          label="Email"
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          autoComplete="email"
          required
        />
        <FormField
          label="Password"
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          autoComplete="new-password"
          required
        />
        <SubmitButton loading={loading}>Create account</SubmitButton>
      </form>
      <p className="font-exo mt-4 text-center text-sm text-vv-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="text-vv-neon-green">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
