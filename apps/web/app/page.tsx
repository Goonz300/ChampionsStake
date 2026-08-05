import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="font-orbitron text-vv-neon-green text-3xl font-bold">ChampionsStake</h1>
      <p className="font-exo text-vv-text-secondary max-w-md text-center">
        A competitive gaming marketplace where players stake funds into escrow before competing in
        skill-based matches. The full marketing landing page is a later frontend task — this phase
        built the authentication system that powers everything behind it.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="font-exo border-vv-divider hover:border-vv-neon-green rounded border px-6 py-2 text-white"
        >
          Log in
        </Link>
        <Link
          href="/register"
          className="font-exo bg-vv-neon-green text-vv-black rounded px-6 py-2 font-semibold hover:opacity-90"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}
