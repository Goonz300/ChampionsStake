"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Game {
  id: string;
  name: string;
}

export function CreateTournamentForm({ games }: { games: Game[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [format, setFormat] = useState("single_elim");
  const [entryFeeCents, setEntryFeeCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, gameId, format, entryFeeCents }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to create tournament.");
        return;
      }
      router.push(`/tournaments/${body.data.id}`);
    } catch {
      setError("Failed to create tournament. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-4">
      <div>
        <label htmlFor="name" className="font-exo text-vv-text-secondary block text-sm">
          Tournament name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={3}
          className="border-vv-divider font-exo mt-1 w-full rounded border bg-transparent px-3 py-1.5 text-sm text-white"
        />
      </div>

      <div>
        <label htmlFor="game" className="font-exo text-vv-text-secondary block text-sm">
          Game
        </label>
        <select
          id="game"
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          className="border-vv-divider font-exo mt-1 w-full rounded border bg-transparent px-3 py-1.5 text-sm text-white"
        >
          {games.map((g) => (
            <option key={g.id} value={g.id} className="bg-vv-black">
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="format" className="font-exo text-vv-text-secondary block text-sm">
          Format
        </label>
        <select
          id="format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="border-vv-divider font-exo mt-1 w-full rounded border bg-transparent px-3 py-1.5 text-sm text-white"
        >
          <option value="single_elim" className="bg-vv-black">
            Single Elimination
          </option>
          <option value="double_elim" className="bg-vv-black">
            Double Elimination
          </option>
          <option value="round_robin" className="bg-vv-black">
            Round Robin
          </option>
          <option value="swiss" className="bg-vv-black">
            Swiss
          </option>
        </select>
      </div>

      <div>
        <label htmlFor="entryFee" className="font-exo text-vv-text-secondary block text-sm">
          Entry fee (cents, 0 for free)
        </label>
        <input
          id="entryFee"
          type="number"
          min={0}
          value={entryFeeCents}
          onChange={(e) => setEntryFeeCents(Number(e.target.value))}
          className="border-vv-divider font-exo mt-1 w-full rounded border bg-transparent px-3 py-1.5 text-sm text-white"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !gameId}
        className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create Tournament"}
      </button>
      {error && <p className="font-exo text-vv-loss-red text-xs">{error}</p>}
    </form>
  );
}
