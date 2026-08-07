"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteMemberForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
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
        body: JSON.stringify({ action: "invite", teamId, invitedUserId: userId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to send invitation.");
        return;
      }
      setUserId("");
      router.refresh();
    } catch {
      setError("Failed to send invitation. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
      <input
        type="text"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="User ID to invite"
        required
        className="border-vv-divider font-exo w-64 rounded border bg-transparent px-3 py-1.5 text-sm text-white"
      />
      <button
        type="submit"
        disabled={loading}
        className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {loading ? "Inviting..." : "Invite"}
      </button>
      {error && <p className="font-exo text-vv-loss-red self-center text-xs">{error}</p>}
    </form>
  );
}
