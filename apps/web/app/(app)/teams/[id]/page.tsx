import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TournamentNav } from "@/components/nav/TournamentNav";
import { InviteMemberForm } from "@/components/teams/InviteMemberForm";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, team_type, description, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!team) notFound();

  const { data: members } = await supabase
    .from("team_members")
    .select("user_id, role, joined_at, profiles(display_name)")
    .eq("team_id", id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  const myMembership = (members ?? []).find((m) => m.user_id === user.id);
  const canInvite = myMembership?.role === "owner" || myMembership?.role === "captain";

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <TournamentNav active="/teams" />
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">{team.name}</h1>
      {team.description && (
        <p className="font-exo text-vv-text-secondary mt-2 text-sm">{team.description}</p>
      )}

      <h2 className="font-orbitron mt-6 text-lg font-semibold text-white">Roster</h2>
      <table className="font-exo mt-3 w-full min-w-[400px] text-left text-sm">
        <caption className="sr-only">Team roster</caption>
        <thead>
          <tr className="border-vv-divider text-vv-text-tertiary border-b text-xs uppercase">
            <th className="py-2">Player</th>
            <th className="py-2">Role</th>
            <th className="py-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {(members ?? []).map((m) => (
            <tr key={m.user_id} className="border-vv-divider border-b last:border-0">
              <td className="py-2">
                {(m.profiles as unknown as { display_name: string } | null)?.display_name ??
                  m.user_id}
              </td>
              <td className="py-2 capitalize">{m.role}</td>
              <td className="py-2">{new Date(m.joined_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {canInvite && (
        <>
          <h2 className="font-orbitron mt-6 text-lg font-semibold text-white">Invite a member</h2>
          <InviteMemberForm teamId={id} />
        </>
      )}
    </main>
  );
}
