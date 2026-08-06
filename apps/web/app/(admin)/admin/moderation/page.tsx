import { ModerationQueuePanel } from "@/components/admin/ModerationQueuePanel";

/**
 * Phase 3D minimal moderator UI. Reachable by an active moderator OR
 * administrator -- enforced entirely by middleware.ts's existing
 * isModerationPath gate (is_moderator() RPC), not a second auth check
 * duplicated in this page. See app/(admin)/page.tsx's doc comment for the
 * same reasoning applied to the admin-only page.
 */
export default function ModerationPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-orbitron mb-1 text-2xl text-white">Moderation Queue</h1>
      <p className="font-exo text-vv-text-secondary mb-6 text-sm">
        Proxied through /api/moderation/queue to the existing moderator-dashboard Edge Function.
      </p>
      <ModerationQueuePanel />
    </main>
  );
}
