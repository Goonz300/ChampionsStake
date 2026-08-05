import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Minimal authenticated landing page. This phase's job is authentication,
 * not the dashboard UI (that's Roadmap FE-003, a later Phase 2 task porting
 * the approved prototype's dashboard screen) — this page exists only so
 * middleware's post-login redirect target actually resolves to something
 * real, showing genuine session data rather than a fake placeholder.
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, status, kyc_status, trust_score")
    .eq("id", user.id)
    .single();

  return (
    <main className="bg-vv-black min-h-screen p-8 text-white">
      <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">
        Welcome, {profile?.display_name ?? user.email}
      </h1>
      <dl className="font-exo text-vv-text-secondary mt-6 space-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-40">Account status</dt>
          <dd>{profile?.status}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-40">KYC status</dt>
          <dd>{profile?.kyc_status}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-vv-text-tertiary w-40">Trust score</dt>
          <dd>{profile?.trust_score}</dd>
        </div>
      </dl>
      <p className="font-exo text-vv-text-tertiary mt-8 text-sm">
        Challenge browsing, the Vault, and Social are built in later phases (Roadmap Phase 2
        onward).
      </p>
    </main>
  );
}
