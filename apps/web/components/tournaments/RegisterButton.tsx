"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Client component for the one genuinely interactive action on the
 * tournament detail page -- mirrors MfaSection.tsx's local useState
 * loading/error pattern (no form library in use anywhere in this repo). */
export function RegisterButton({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tournaments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to register.");
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to register. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleRegister}
        disabled={loading}
        className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {loading ? "Registering..." : "Register"}
      </button>
      {error && <p className="font-exo text-vv-loss-red mt-2 text-xs">{error}</p>}
    </div>
  );
}
