"use client";

import { useEffect, useState } from "react";

/**
 * Phase 3D minimal moderator UI (see FeatureFlagsPanel.tsx's doc comment
 * for the same reasoning). This proves the moderator half of the
 * authorization chain specifically: middleware.ts's isModerationPath gate
 * calls is_moderator() (allowing BOTH moderator and administrator, unlike
 * /admin's is_admin-only gate) -- then /api/moderation/queue re-checks
 * is_moderator before forwarding to the existing moderator-dashboard Edge
 * Function's ?view=queue.
 */

interface QueueItem {
  id: string;
  display_state: string;
  priority: string;
}

export function ModerationQueuePanel() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/moderation/queue");
        const json = await res.json();
        if (!res.ok) {
          setError(json.error?.message ?? "Failed to load the dispute queue.");
          return;
        }
        setItems(json.data);
      } catch {
        setError("Failed to load the dispute queue.");
      }
    })();
  }, []);

  if (error) {
    return (
      <p role="alert" className="font-exo text-vv-loss-red text-sm">
        {error}
      </p>
    );
  }

  if (items === null) {
    return <p className="font-exo text-vv-text-secondary text-sm">Loading dispute queue…</p>;
  }

  if (items.length === 0) {
    return <p className="font-exo text-vv-text-secondary text-sm">No disputes in the queue.</p>;
  }

  return (
    <table className="font-exo w-full text-left text-sm">
      <thead>
        <tr className="border-vv-divider border-b text-xs uppercase">
          <th className="py-2">Dispute</th>
          <th className="py-2">State</th>
          <th className="py-2">Priority</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-vv-divider border-b">
            <td className="py-2 text-white">{item.id}</td>
            <td className="text-vv-text-secondary py-2">{item.display_state}</td>
            <td className="text-vv-text-secondary py-2">{item.priority}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
