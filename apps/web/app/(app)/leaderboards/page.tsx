import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";

interface LeaderboardRow {
  userId: string;
  rating: number;
  matchesPlayed: number;
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ gameId?: string }>;
}) {
  const { gameId: requestedGameId } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: games } = await supabase
    .from("games")
    .select("id, name")
    .eq("active", true)
    .order("name");

  const gameId = requestedGameId ?? games?.[0]?.id;

  let leaderboard: LeaderboardRow[] = [];
  let displayNames = new Map<string, string>();
  if (gameId) {
    const { data, error } = await supabase.functions.invoke(
      `ranking-manage?view=leaderboard&gameId=${gameId}&scopeType=global`,
      { method: "GET" },
    );
    if (!error) {
      leaderboard = (data as { data: LeaderboardRow[] }).data ?? [];
      const userIds = leaderboard.map((r) => r.userId);
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", userIds);
        displayNames = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
      }
    }
  }

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/leaderboards" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Leaderboards</h1>

      <div className="font-exo mt-4 flex gap-2 text-sm">
        {(games ?? []).map((g) => (
          <a
            key={g.id}
            href={`/leaderboards?gameId=${g.id}`}
            className={
              g.id === gameId
                ? "text-vv-neon-green font-semibold"
                : "text-vv-text-secondary hover:text-white"
            }
          >
            {g.name}
          </a>
        ))}
      </div>

      <table className="font-exo mt-6 w-full min-w-[400px] text-left text-sm">
        <caption className="sr-only">Global leaderboard</caption>
        <thead>
          <tr className="border-vv-divider text-vv-text-tertiary border-b text-xs uppercase">
            <th className="py-2">Rank</th>
            <th className="py-2">Player</th>
            <th className="py-2">Rating</th>
            <th className="py-2">Matches</th>
          </tr>
        </thead>
        <tbody>
          {leaderboard.map((row, i) => (
            <tr key={row.userId} className="border-vv-divider border-b last:border-0">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">{displayNames.get(row.userId) ?? row.userId}</td>
              <td className="py-2">{Math.round(row.rating)}</td>
              <td className="py-2">{row.matchesPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {leaderboard.length === 0 && (
        <p className="font-exo text-vv-text-tertiary mt-6 text-sm">No ratings yet for this game.</p>
      )}
    </main>
  );
}
