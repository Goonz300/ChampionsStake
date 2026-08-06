"use client";

import { useEffect, useState } from "react";

/**
 * Phase 3D minimal admin UI (per the approved brief: "keep UI
 * intentionally minimal... only build enough to prove RBAC works,
 * authorization works, middleware works, existing Edge Functions can be
 * consumed correctly. Focus on correctness. Not polish.").
 *
 * This is the ONE proof surface for the whole admin authorization chain:
 * middleware.ts gates the /admin page itself (is_admin RPC, Phase 3D
 * Milestone 1); this component then calls /api/admin/feature-flags (a
 * real, newly-built explicit route, not a stub) with the browser's own
 * session cookies, which itself re-checks is_admin before forwarding to
 * the existing admin-feature-flags Edge Function -- which does its own
 * requireAdministrator check against the same caller a third time. A
 * request that reaches this component and successfully lists/toggles a
 * flag has passed through every layer of the authorization model this
 * phase built or extended.
 */

interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  requires_dual_approval: boolean;
}

export function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/admin/feature-flags");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Failed to load feature flags.");
        return;
      }
      setFlags(json.data);
    } catch {
      setError("Failed to load feature flags.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(flag: FeatureFlag) {
    setError(null);
    setPendingKey(flag.key);
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: flag.key, enabled: !flag.enabled }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Failed to update flag.");
        return;
      }
      await load();
    } catch {
      setError("Failed to update flag.");
    } finally {
      setPendingKey(null);
    }
  }

  if (error) {
    return (
      <p role="alert" className="font-exo text-vv-loss-red text-sm">
        {error}
      </p>
    );
  }

  if (flags === null) {
    return <p className="font-exo text-vv-text-secondary text-sm">Loading feature flags…</p>;
  }

  return (
    <table className="font-exo w-full text-left text-sm">
      <thead>
        <tr className="border-vv-divider border-b text-xs uppercase">
          <th className="py-2">Key</th>
          <th className="py-2">Status</th>
          <th className="py-2">Dual approval</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {flags.map((flag) => (
          <tr key={flag.key} className="border-vv-divider border-b">
            <td className="py-2 text-white">{flag.key}</td>
            <td className="py-2">
              <span className={flag.enabled ? "text-vv-success-green" : "text-vv-text-tertiary"}>
                {flag.enabled ? "Enabled" : "Disabled"}
              </span>
            </td>
            <td className="text-vv-text-secondary py-2">
              {flag.requires_dual_approval ? "Yes" : "No"}
            </td>
            <td className="py-2 text-right">
              <button
                type="button"
                onClick={() => toggle(flag)}
                disabled={pendingKey === flag.key}
                className="border-vv-divider hover:border-vv-neon-green rounded border px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {flag.enabled ? "Disable" : "Enable"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
