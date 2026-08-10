import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Phase 8.5 performance review fix: none of these three queries depend
  // on each other's result (divisions/seasons only need the route id, not
  // the resolved league row) -- fetched concurrently instead of three
  // sequential round trips.
  const [{ data: league }, { data: divisions }, { data: seasons }] = await Promise.all([
    supabase.from("leagues").select("id, name, status").eq("id", id).maybeSingle(),
    supabase
      .from("divisions")
      .select("id, name, tier")
      .eq("league_id", id)
      .order("tier", { ascending: true }),
    supabase
      .from("seasons")
      .select("id, name, status, starts_at, ends_at")
      .eq("league_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!league) notFound();

  const activeSeason = (seasons ?? []).find((s) => s.status === "active");

  const standingsByDivision = new Map<
    string,
    {
      user_id: string | null;
      team_id: string | null;
      points: number;
      wins: number;
      losses: number;
    }[]
  >();
  if (activeSeason) {
    const { data: standings } = await supabase
      .from("season_participants")
      .select("division_id, user_id, team_id, points, wins, losses")
      .eq("season_id", activeSeason.id)
      .order("points", { ascending: false });
    for (const s of standings ?? []) {
      const list = standingsByDivision.get(s.division_id) ?? [];
      list.push(s);
      standingsByDivision.set(s.division_id, list);
    }
  }

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/leagues" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">{league.name}</h1>

      <h2 className="font-orbitron mt-6 text-lg font-semibold text-white">
        {activeSeason ? `Standings — ${activeSeason.name}` : "No active season"}
      </h2>

      {(divisions ?? []).map((div) => (
        <div key={div.id} className="mt-4">
          <h3 className="font-exo text-vv-text-secondary text-sm font-semibold">
            {div.name} (Tier {div.tier})
          </h3>
          <table className="font-exo mt-2 w-full min-w-[400px] text-left text-sm">
            <caption className="sr-only">{div.name} standings</caption>
            <thead>
              <tr className="border-vv-divider text-vv-text-tertiary border-b text-xs uppercase">
                <th className="py-2">Rank</th>
                <th className="py-2">Participant</th>
                <th className="py-2">W</th>
                <th className="py-2">L</th>
                <th className="py-2">Points</th>
              </tr>
            </thead>
            <tbody>
              {(standingsByDivision.get(div.id) ?? []).map((s, i) => (
                <tr
                  key={s.user_id ?? s.team_id}
                  className="border-vv-divider border-b last:border-0"
                >
                  <td className="py-2">{i + 1}</td>
                  <td className="py-2">{s.user_id ?? s.team_id}</td>
                  <td className="py-2">{s.wins}</td>
                  <td className="py-2">{s.losses}</td>
                  <td className="py-2">{s.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </main>
  );
}
