import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";
import { RegisterButton } from "@/components/tournaments/RegisterButton";

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Phase 8.5 performance review fix: these two queries don't depend on
  // each other (existingRegistration only needs the route id + user.id,
  // not the resolved tournament row) -- fetched concurrently instead of
  // as two sequential round trips.
  const [{ data: tournament }, { data: existingRegistration }] = await Promise.all([
    supabase
      .from("tournaments")
      .select(
        "id, name, format, status, entry_fee_cents, prize_pool_cents, starts_at, registration_opens_at, registration_closes_at, sponsor_name, created_by, visibility",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tournament_registrations")
      .select("id")
      .eq("tournament_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!tournament) notFound();

  const canRegister = tournament.status === "registration" && !existingRegistration;

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/tournaments" />
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">{tournament.name}</h1>
          {tournament.sponsor_name && (
            <p className="font-exo text-vv-text-tertiary mt-1 text-sm">
              Sponsored by {tournament.sponsor_name}
            </p>
          )}
        </div>
        <span className="bg-vv-success-green/10 text-vv-success-green rounded px-2 py-0.5 text-xs uppercase">
          {tournament.status}
        </span>
      </div>

      <dl className="font-exo text-vv-text-secondary mt-6 space-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-40">Format</dt>
          <dd>{tournament.format}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-40">Entry fee</dt>
          <dd>
            {tournament.entry_fee_cents === 0
              ? "Free"
              : `$${(tournament.entry_fee_cents / 100).toFixed(2)}`}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-40">Prize pool</dt>
          <dd>${(tournament.prize_pool_cents / 100).toFixed(2)}</dd>
        </div>
        {tournament.starts_at && (
          <div className="flex gap-2">
            <dt className="text-vv-text-tertiary w-40">Starts</dt>
            <dd>{new Date(tournament.starts_at).toLocaleString()}</dd>
          </div>
        )}
      </dl>

      <div className="mt-6 flex gap-3">
        <Link
          href={`/tournaments/${id}/bracket`}
          className="font-exo border-vv-divider hover:border-vv-neon-green rounded border px-3 py-1.5 text-sm text-white transition-colors"
        >
          View bracket
        </Link>
        <a
          href={`/api/tournaments?view=ics&tournamentId=${id}`}
          className="font-exo border-vv-divider hover:border-vv-neon-green rounded border px-3 py-1.5 text-sm text-white transition-colors"
        >
          Add to calendar
        </a>
      </div>

      {existingRegistration && (
        <p className="font-exo text-vv-success-green mt-6 text-sm">
          You are registered for this tournament.
        </p>
      )}
      {canRegister && (
        <div className="mt-6">
          <RegisterButton tournamentId={id} />
        </div>
      )}
    </main>
  );
}
