"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField, SubmitButton, FormBanner } from "@/components/auth/form-elements";
import { resetPasswordSchema } from "@/lib/auth/validation";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(undefined);

    const parsed = resetPasswordSchema.safeParse({ password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    if (password !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 410) {
          router.push("/session-expired");
          return;
        }
        setError(json.error?.message ?? "Something went wrong.");
        return;
      }

      router.push("/login?message=password_reset");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Set a new password">
      {error && <FormBanner kind="error" message={error} />}
      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="New password"
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldError}
          autoComplete="new-password"
          required
        />
        <FormField
          label="Confirm new password"
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <SubmitButton loading={loading}>Reset password</SubmitButton>
      </form>
    </AuthCard>
  );
}
