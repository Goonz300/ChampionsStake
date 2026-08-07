import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";
import { BracketView } from "@/components/tournaments/BracketView";

export default async function TournamentBracketPage({
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

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/tournaments" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">
        {tournament?.name ?? "Tournament"} &middot; Bracket
      </h1>
      <div className="mt-6">
        <BracketView tournamentId={id} />
      </div>
    </main>
  );
}
