"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateTeamForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name, teamType: "team" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to create team.");
        return;
      }
      router.push(`/teams/${body.data.id}`);
    } catch {
      setError("Failed to create team. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        required
        minLength={2}
        className="border-vv-divider font-exo rounded border bg-transparent px-3 py-1.5 text-sm text-white"
      />
      <button
        type="submit"
        disabled={loading || name.length < 2}
        className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create Team"}
      </button>
      {error && <p className="font-exo text-vv-loss-red self-center text-xs">{error}</p>}
    </form>
  );
}
