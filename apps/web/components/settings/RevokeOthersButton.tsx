"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The one real action this phase's session list supports. There is no
 * per-row revoke button anywhere in this page — GoTrue offers
 * auth.signOut({scope:"others"}) and nothing more granular (Phase 3
 * Architecture Rev. 2, §8); a per-session revoke control would promise a
 * capability that doesn't exist at any layer of this stack.
 */
export function RevokeOthersButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/auth/sessions/revoke-others", { method: "POST" });
      const body = await res.json();

      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to sign out other devices.");
        return;
      }

      const count: number = body?.data?.revoked_count ?? 0;
      setResult(
        count === 0
          ? "No other active sessions to sign out."
          : `Signed out ${count} other session${count === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch {
      setError("Failed to sign out other devices. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="font-exo bg-vv-loss-red rounded px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        aria-busy={loading}
      >
        {loading ? "Signing out other devices…" : "Log out other devices"}
      </button>
      {error ? (
        <p role="alert" className="font-exo text-vv-loss-red mt-2 text-sm">
          {error}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="font-exo text-vv-success-green mt-2 text-sm">
          {result}
        </p>
      ) : null}
    </div>
  );
}
