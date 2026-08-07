import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";

export default async function LeaguesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, status, games(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/leagues" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Leagues</h1>

      <ul className="mt-6 space-y-3">
        {(leagues ?? []).map((l) => (
          <li key={l.id}>
            <Link
              href={`/leagues/${l.id}`}
              className="border-vv-divider hover:border-vv-neon-green flex items-center justify-between rounded border p-4 transition-colors"
            >
              <div>
                <span className="font-exo text-base font-semibold text-white">{l.name}</span>
                <span className="font-exo text-vv-text-tertiary ml-3 text-xs">
                  {(l.games as unknown as { name: string } | null)?.name}
                </span>
              </div>
              <span className="bg-vv-success-green/10 text-vv-success-green rounded px-2 py-0.5 text-xs uppercase">
                {l.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {(leagues ?? []).length === 0 && (
        <p className="font-exo text-vv-text-tertiary mt-8 text-sm">No leagues yet.</p>
      )}
    </main>
  );
}
