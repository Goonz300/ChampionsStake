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
      <h1 className="font-orbitron text-3xl font-bold text-vv-neon-green">ChampionsStake</h1>
      <p className="font-exo max-w-md text-center text-vv-text-secondary">
        A competitive gaming marketplace where players stake funds into escrow
        before competing in skill-based matches. The full marketing landing
        page is a later frontend task — this phase built the authentication
        system that powers everything behind it.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="font-exo rounded border border-vv-divider px-6 py-2 text-white hover:border-vv-neon-green"
        >
          Log in
        </Link>
        <Link
          href="/register"
          className="font-exo rounded bg-vv-neon-green px-6 py-2 font-semibold text-vv-black hover:opacity-90"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}
