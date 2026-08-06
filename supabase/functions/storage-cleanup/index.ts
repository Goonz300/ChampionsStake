// supabase/functions/storage-cleanup/index.ts
//
// Scheduled cleanup for:
//   - Expired uploads: file_uploads rows stuck in 'pending' (upload started,
//     metadata written, but never confirmed active) past a bucket-specific
//     grace period.
//   - Abandoned challenge/dispute media: files whose related challenge is
//     long-terminal (cancelled/expired/archived) AND past that bucket's
//     retention window (see lib/storage/config.ts's retentionDays).
//   - Orphaned storage.objects: objects that exist in a bucket but have no
//     corresponding file_uploads row at all (should not happen via the
//     normal upload path, but can occur from manual testing/incomplete
//     migrations — this pass catches and removes them defensively).
//
// This MUST run as an Edge Function (not a bare SQL function invoked by
// pg_cron) because deleting a storage object correctly requires calling the
// Storage API (supabase.storage.from(bucket).remove(...)), which also
// removes the underlying blob. Deleting rows directly from storage.objects
// via SQL does not reliably clean up the backing blob and would create
// exactly the kind of orphan this job exists to prevent.
//
// Scheduled via pg_cron + pg_net calling this function's URL — see
// supabase/migrations/0033_storage_cleanup_schedule.sql.

import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";

const PENDING_GRACE_HOURS = 24;

interface CleanupSummary {
  expiredPendingRemoved: number;
  abandonedMediaRemoved: number;
  orphanedObjectsRemoved: number;
  errors: string[];
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("STORAGE_CLEANUP_SHARED_SECRET");

  // pg_net's http_post can attach a static bearer token configured at
  // schedule time; this is a defense-in-depth check so the function isn't
  // callable by anyone who merely learns its URL.
  if (
    !expectedSecret || !authHeader ||
    !timingSafeEqual(authHeader, `Bearer ${expectedSecret}`)
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary: CleanupSummary = {
    expiredPendingRemoved: 0,
    abandonedMediaRemoved: 0,
    orphanedObjectsRemoved: 0,
    errors: [],
  };

  // --- 1. Expired pending uploads --------------------------------------
  const staleCutoff = new Date(
    Date.now() - PENDING_GRACE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data: stalePending, error: staleError } = await supabase
    .from("file_uploads")
    .select("id, bucket, storage_path")
    .eq("status", "pending")
    .lt("created_at", staleCutoff);

  if (staleError) {
    summary.errors.push(
      `Failed to query stale pending uploads: ${staleError.message}`,
    );
  } else {
    for (const row of stalePending ?? []) {
      const { error: removeError } = await supabase.storage.from(row.bucket)
        .remove([row.storage_path]);
      if (removeError) {
        summary.errors.push(
          `Failed to remove ${row.bucket}/${row.storage_path}: ${removeError.message}`,
        );
        continue;
      }
      await supabase
        .from("file_uploads")
        .update({ status: "deleted", deleted_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.expiredPendingRemoved += 1;
    }
  }

  // --- 2. Abandoned challenge media past retention ----------------------
  // Retention windows are bucket-specific (lib/storage/config.ts); this
  // function hard-codes the same 365-day figure for chat-media/
  // challenge-media/voice-notes rather than importing the TS config
  // (Edge Functions run on Deno and don't share a module graph with the
  // Next.js app) — kept in sync manually, flagged in the deliverable doc as
  // a duplication to watch for drift.
  const retentionCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString();
  const { data: abandoned, error: abandonedError } = await supabase
    .from("file_uploads")
    .select("id, bucket, storage_path, related_table, related_id")
    .in("bucket", ["chat-media", "challenge-media", "voice-notes"])
    .eq("status", "active")
    .lt("created_at", retentionCutoff);

  if (abandonedError) {
    summary.errors.push(
      `Failed to query abandoned media: ${abandonedError.message}`,
    );
  } else {
    for (const row of abandoned ?? []) {
      if (row.related_table !== "challenges" || !row.related_id) continue;

      const { data: challenge } = await supabase
        .from("challenges")
        .select("status")
        .eq("id", row.related_id)
        .maybeSingle();

      const terminalStatuses = [
        "completed",
        "cancelled",
        "expired",
        "archived",
      ];
      if (!challenge || !terminalStatuses.includes(challenge.status)) continue;

      const { error: removeError } = await supabase.storage.from(row.bucket)
        .remove([row.storage_path]);
      if (removeError) {
        summary.errors.push(
          `Failed to remove ${row.bucket}/${row.storage_path}: ${removeError.message}`,
        );
        continue;
      }
      await supabase
        .from("file_uploads")
        .update({ status: "deleted", deleted_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.abandonedMediaRemoved += 1;
    }
  }

  // --- 3. Orphaned storage.objects (no matching file_uploads row) --------
  // Deliberately queries the storage.objects table directly (via the
  // service-role client's schema-qualified access) rather than
  // supabase.storage.from(bucket).list(), because list() without a path
  // only returns immediate children — for our `{entityId}/{filename}` path
  // convention that would return entity-id "folders", not the files nested
  // under them. Reading storage.objects directly avoids that shallow-listing
  // limitation entirely.
  const buckets = [
    "avatars",
    "challenge-media",
    "proof-images",
    "proof-videos",
    "chat-media",
    "voice-notes",
    "kyc-documents",
    "tournament-assets",
    "system-assets",
  ];

  for (const bucket of buckets) {
    const { data: objects, error: listError } = await supabase
      .schema("storage")
      .from("objects")
      .select("name")
      .eq("bucket_id", bucket)
      .limit(1000);

    if (listError) {
      summary.errors.push(
        `Failed to list bucket ${bucket}: ${listError.message}`,
      );
      continue;
    }

    for (const obj of objects ?? []) {
      if (!obj.name) continue;
      const { data: metadataRow } = await supabase
        .from("file_uploads")
        .select("id")
        .eq("bucket", bucket)
        .eq("storage_path", obj.name)
        .maybeSingle();

      if (!metadataRow) {
        const { error: removeError } = await supabase.storage.from(bucket)
          .remove([obj.name]);
        if (!removeError) {
          summary.orphanedObjectsRemoved += 1;
        } else {
          summary.errors.push(
            `Failed to remove orphan ${bucket}/${obj.name}: ${removeError.message}`,
          );
        }
      }
    }
  }

  return new Response(JSON.stringify({ data: summary }), {
    headers: { "Content-Type": "application/json" },
  });
});
