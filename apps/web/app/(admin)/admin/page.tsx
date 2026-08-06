import { FeatureFlagsPanel } from "@/components/admin/FeatureFlagsPanel";

/**
 * Phase 3D minimal admin UI. Reachable only by an active administrator --
 * enforced entirely by middleware.ts's existing isAdminPath gate (Phase 3D
 * Milestone 1: a single is_admin() RPC call, the same one RLS policies
 * use), not a second auth check duplicated in this page. No page-level
 * auth code is needed or added here; the middleware boundary is already
 * this app's single source of truth for who may render this route.
 *
 * Deliberately minimal per the approved brief: one real, working panel
 * (feature flags: list + toggle) proving the full chain works, not a
 * built-out dashboard. ADMIN-001's Edge Functions support far more
 * (users, wallets, tournaments, announcements, audit, system health) --
 * all already reachable via this phase's own /api/admin/* routes -- but
 * this page intentionally does not surface all of it.
 */
export default function AdminPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-orbitron mb-1 text-2xl text-white">Admin</h1>
      <p className="font-exo text-vv-text-secondary mb-6 text-sm">
        Feature flags — list and toggle, proxied through /api/admin/feature-flags to the existing
        admin-feature-flags Edge Function.
      </p>
      <FeatureFlagsPanel />
    </main>
  );
}
