import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";

interface TournamentListRow {
  id: string;
  name: string;
  format: string;
  status: string;
  entry_fee_cents: number;
  starts_at: string | null;
  visibility: string;
  sponsor_name: string | null;
}

/**
 * Tournament list (Phase 8 frontend). Calls tournament-browse directly via
 * the authenticated server-side Supabase client (same one createClient()
 * already sets up from cookies) -- not a raw table query, since
 * tournament-browse's visibility filtering (private/invite-only tournaments
 * hidden from non-organizers, Phase 8 M6) is application logic that lives
 * ONLY there, not in RLS; duplicating it into a second Supabase query here
 * would risk the two drifting apart.
 */
export default async function TournamentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.functions.invoke("tournament-browse?view=list", {
    method: "GET",
  });

  const tournaments = (error ? [] : (data as { data: TournamentListRow[] }).data) ?? [];

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/tournaments" />
      <div className="flex items-center justify-between">
        <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Tournaments</h1>
        <Link
          href="/tournaments/new"
          className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black"
        >
          Create Tournament
        </Link>
      </div>

      {error && (
        <p className="font-exo text-vv-loss-red mt-4 text-sm">
          Failed to load tournaments. Please try again.
        </p>
      )}

      {!error && tournaments.length === 0 && (
        <p className="font-exo text-vv-text-tertiary mt-8 text-sm">No tournaments yet.</p>
      )}

      <ul className="mt-6 space-y-3">
        {tournaments.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tournaments/${t.id}`}
              className="border-vv-divider hover:border-vv-neon-green block rounded border p-4 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-exo text-base font-semibold text-white">{t.name}</span>
                <span className="bg-vv-success-green/10 text-vv-success-green rounded px-2 py-0.5 text-xs uppercase">
                  {t.status}
                </span>
              </div>
              <dl className="font-exo text-vv-text-secondary mt-2 flex gap-6 text-xs">
                <div>
                  <dt className="text-vv-text-tertiary inline">Format: </dt>
                  <dd className="inline">{t.format}</dd>
                </div>
                <div>
                  <dt className="text-vv-text-tertiary inline">Entry: </dt>
                  <dd className="inline">
                    {t.entry_fee_cents === 0 ? "Free" : `$${(t.entry_fee_cents / 100).toFixed(2)}`}
                  </dd>
                </div>
                {t.sponsor_name && (
                  <div>
                    <dt className="text-vv-text-tertiary inline">Sponsor: </dt>
                    <dd className="inline">{t.sponsor_name}</dd>
                  </div>
                )}
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
