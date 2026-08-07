import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";

interface OrganizerDashboard {
  reputationScore: number;
  tournamentCounts: Record<string, number>;
  templateCount: number;
}

export default async function OrganizerDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.functions.invoke("tournament-organize?view=dashboard", {
    method: "GET",
  });

  if (error) {
    return (
      <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
        <TournamentNav active="/organizer" />
        <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Organizer Dashboard</h1>
        <p className="font-exo text-vv-text-tertiary mt-6 text-sm">
          Organizer access is required to view this page. Contact an administrator to request
          organizer status.
        </p>
      </main>
    );
  }

  const dashboard = (data as { data: OrganizerDashboard }).data;

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/organizer" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Organizer Dashboard</h1>

      <dl className="font-exo text-vv-text-secondary mt-6 space-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-48">Organizer reputation</dt>
          <dd>{Math.round(dashboard.reputationScore)} / 100</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-48">Templates</dt>
          <dd>{dashboard.templateCount}</dd>
        </div>
      </dl>

      <h2 className="font-orbitron mt-6 text-lg font-semibold text-white">Tournaments by status</h2>
      <ul className="font-exo text-vv-text-secondary mt-3 space-y-1 text-sm">
        {Object.entries(dashboard.tournamentCounts).map(([status, count]) => (
          <li key={status} className="flex gap-2">
            <span className="text-vv-text-tertiary w-40 capitalize">{status}</span>
            <span>{count}</span>
          </li>
        ))}
      </ul>
      {Object.keys(dashboard.tournamentCounts).length === 0 && (
        <p className="font-exo text-vv-text-tertiary mt-3 text-sm">
          You haven&apos;t created any tournaments yet.
        </p>
      )}
    </main>
  );
}
