import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";
import { CreateTeamForm } from "@/components/teams/CreateTeamForm";

export default async function TeamsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, team_type, avatar_url")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/teams" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Teams</h1>

      <div className="mt-4">
        <CreateTeamForm />
      </div>

      <ul className="mt-6 space-y-3">
        {(teams ?? []).map((t) => (
          <li key={t.id}>
            <Link
              href={`/teams/${t.id}`}
              className="border-vv-divider hover:border-vv-neon-green flex items-center justify-between rounded border p-4 transition-colors"
            >
              <span className="font-exo text-base font-semibold text-white">{t.name}</span>
              <span className="bg-vv-success-green/10 text-vv-success-green rounded px-2 py-0.5 text-xs uppercase">
                {t.team_type}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {(teams ?? []).length === 0 && (
        <p className="font-exo text-vv-text-tertiary mt-8 text-sm">
          No teams yet. Create the first one above.
        </p>
      )}
    </main>
  );
}
