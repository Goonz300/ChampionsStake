/**
 * Merges freshly-arrived rows (from either a Postgres Changes event or a
 * sync-events replay) into an existing list, de-duplicated by `id` and
 * re-sorted newest-first by `created_at`. Both useNotifications and
 * useChallengeEvents need this same "the live subscription and the
 * reconnect resync can legitimately both deliver the same row" merge --
 * shared here instead of reimplemented per hook (this phase's "duplicate
 * suppression" requirement).
 */
export function mergeById<T extends { id: string; created_at: string }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) {
    byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}
