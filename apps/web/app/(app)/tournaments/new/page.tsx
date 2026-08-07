import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";
import { CreateTournamentForm } from "@/components/tournaments/CreateTournamentForm";

export default async function NewTournamentPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const canCreate = profile?.role === "organizer" || profile?.role === "administrator";

  const { data: games } = await supabase
    .from("games")
    .select("id, name")
    .eq("active", true)
    .order("name");

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/tournaments" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Create Tournament</h1>

      {!canCreate && (
        <p className="font-exo text-vv-text-tertiary mt-6 text-sm">
          Organizer access is required to create tournaments. Contact an administrator to request
          organizer status.
        </p>
      )}
      {canCreate && <CreateTournamentForm games={games ?? []} />}
    </main>
  );
}
