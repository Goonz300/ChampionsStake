# STORE-001 — Supabase Storage & Media Foundation

## 1. Storage Architecture Overview

Every upload goes through exactly one server-side entry point (`lib/storage/service.ts`'s `uploadFile()`, fronted by `POST /api/storage/upload`), never directly from the browser to Supabase Storage. This is a deliberate choice beyond what storage.objects RLS alone provides: RLS can gate *path and bucket*, but it cannot inspect file *content* — measuring real size and sniffing magic bytes server-side (this phase's "never trust client-provided metadata" requirement) requires the bytes to pass through our own code first. Authorization itself still reuses the exact same Postgres helper functions (`is_challenge_participant`, `can_submit_proof`, `is_admin`, etc. from DB-002) via RPC against the caller's own session — the rule lives in one place (the database) even though the enforcement point for uploads is this service layer rather than RLS directly. storage.objects RLS (DB-002 + this phase's reconciliation) remains in place as defense-in-depth in case anything ever calls Storage directly.

## 2. Bucket Definitions

Reconciled from DB-002's original 5 buckets to this phase's 9-bucket model (migration 0030 — full rationale for every rename/split is in that file's header comment):

| Bucket | Public | Max size | Allowed types | Path convention | Retention |
|---|---|---|---|---|---|
| avatars | Yes | 5MB | jpeg/png/webp | `{user_id}/{file}` | Indefinite |
| challenge-media | No | 100MB | jpeg/png/webp/mp4 | `{challenge_id}/{file}` | 365 days post-terminal |
| proof-images | No | 20MB | jpeg/png/webp | `{dispute_id}/{file}` | Indefinite (compliance) |
| proof-videos | No | 200MB | mp4/quicktime | `{dispute_id}/{file}` | Indefinite (compliance) |
| chat-media | No | 100MB | jpeg/png/webp/mp4 | `{challenge_id}/{file}` | 365 days post-terminal |
| voice-notes | No | 5MB | mpeg/mp4/webm audio | `{challenge_id}/{file}` | 365 days post-terminal |
| kyc-documents | No | 20MB | jpeg/png/pdf | `{user_id}/{file}` | Indefinite (compliance) |
| tournament-assets | Yes | 5MB | jpeg/png/webp | `{tournament_id}/{file}` | Indefinite |
| system-assets | Yes | 10MB | jpeg/png/webp/svg | `{category}/{file}` | Indefinite |

Single TypeScript source of truth for all of the above: `lib/storage/config.ts` (mirrors the SQL bucket definitions so the two can't silently drift).

## 3. Storage Folder Structure (application code, this phase)

```
lib/storage/
  config.ts          bucket definitions (size/type/path/retention)
  validation.ts (+.test.ts)  MIME/size/magic-byte/filename sanitization
  image-processing.ts        extension points only (no-op implementation)
  service.ts          upload/download/delete/replace/signed-url/list/move/copy
app/api/storage/
  upload/route.ts
  files/[fileId]/route.ts    (GET metadata, DELETE)
  signed-url/route.ts
supabase/functions/storage-cleanup/index.ts
supabase/migrations/0030-0033
```

## 4. Storage Policies

`storage.objects` RLS updated by migration 0030 for all 9 buckets (defense-in-depth layer). `file_uploads` gets its own RLS (migration 0032): owner + admin/moderator read, plus narrower participant-visibility policies for shared challenge/dispute media reusing the identical helper functions storage.objects uses — the two layers were written to never disagree about who can see a given file. No client INSERT/UPDATE/DELETE policy exists on `file_uploads` at all; every write goes through the service-role client inside `lib/storage/service.ts`, in the same request that performs the actual Storage API call, so metadata and the real file can never drift apart.

## 5. Media Services

All in `lib/storage/service.ts`: `uploadFile`, `generateSignedDownloadUrl` (+ `refreshSignedDownloadUrl`, an alias — see note below), `generateSignedUploadUrl`, `deleteFile`, `replaceFile` (delete-then-upload, not an in-place overwrite, consistent with every other immutability rule in this schema), `listUserFiles`, `getFileMetadata`, `moveFile`, `copyFile` (same-bucket only, by design — moving across buckets would bypass that bucket's own size/type rules).

**Honesty note on signed URLs**: Supabase Storage cannot revoke an individual signed URL before its expiry — the only real mechanisms are deleting the underlying object or rotating the project's signing key (which invalidates every outstanding signed URL project-wide, not a targeted revoke). `revokeFileAccess()` is implemented as a real delete, not a fake no-op, and is documented as such rather than pretending a per-URL revoke exists.

## 6. Validation Services

`lib/storage/validation.ts`: MIME/extension check against the bucket's allow-list, size check, magic-byte signature check for the 6 types that have a reliable signature (catches the "renamed .exe to .png" class of attack — this is not a virus scanner, that's a documented extension point, not implemented here), filename sanitization (strips path separators and unsafe characters), and duplicate-content detection via SHA-256 checksum stored on every `file_uploads` row (a future dedup feature can query on `checksum_sha256` without this phase needing to implement dedup logic itself). Path traversal is actually prevented at a different layer than sanitization — the real storage path is always server-generated (`{entityId}/{uuid}-{sanitizedName}`), never derived from a client-supplied path string.

## 7. Database Integration

`file_uploads` (migration 0031) — the schema addition this phase required, since none of DB-001's 29 tables tracked owner/checksum/size/MIME/related-entity/visibility/status uniformly across all upload types. Audit-mirrored via `fn_audit_file_upload()` (migration 0032) into the shared `audit_logs` table for both uploads and (soft-)deletes.

**Honesty note on download/permission-failure logging**: uploads and deletes go through Postgres (this service layer), so they're genuinely audit-logged. Downloads via a signed URL do **not** pass through Postgres at all once issued — Supabase's storage server validates the signature independently. A DB trigger structurally cannot observe "someone downloaded this file" any more than DB-002 could observe a denied RLS `SELECT` (same category of Postgres/architecture limitation, documented there and reiterated here rather than silently assumed solved).

## 8. Scheduled Cleanup Design

`supabase/functions/storage-cleanup/index.ts`, scheduled every 6 hours via `pg_cron` + `pg_net` (migration 0033). Handles: (1) uploads stuck in `pending` past a 24-hour grace period, (2) challenge/chat/voice media whose parent challenge is terminal and past its 365-day retention window, (3) orphaned `storage.objects` rows with no matching `file_uploads` metadata (queried directly against `storage.objects` via the service-role client's schema-qualified access, not the Storage `list()` API — `list()` without a path only returns one folder level deep and would miss every file nested under an entity-id folder, a real gap caught and fixed while writing this). This must run as an Edge Function rather than a bare SQL job, because deleting a storage object correctly requires the Storage API itself (`storage.remove()`), not a raw `DELETE FROM storage.objects`, which would leave the backing blob orphaned.

**Expired signed URLs**: no cleanup job exists for these, because there is nothing to clean up — Supabase enforces signed-URL expiry itself at verification time; we never store a "live" signed URL anywhere that could go stale.

## 9. Tests

- `lib/storage/validation.test.ts` — 11 cases: MIME allow-list, size limits, empty-file rejection, magic-byte mismatch (the "renamed file" attack), the deliberate skip-check behavior for types with no registered signature, filename sanitization (including a literal path-traversal string), and checksum determinism/uniqueness.
- Route handlers and `service.ts` are not further unit-tested here beyond the bracket/type-consistency checks performed during writing (same honest limitation as prior phases — no network access to run `npm install`/`npm test`, confirmed again).

## 10. Verification Checklist

- [x] All 9 buckets defined in both SQL (migration 0030) and TypeScript (`config.ts`), kept as parallel sources of truth with an explicit reconciliation note for the DB-002 → STORE-001 rename/split
- [x] `file_uploads` table + RLS covers every requested metadata field (owner, bucket, path, type, size, checksum, timestamp, related entity, visibility, status)
- [x] No client write policy exists on `file_uploads` — verified by re-reading migration 0032, zero `for insert`/`for update`/`for delete` clauses
- [x] Every helper function called from the new SQL (0030, 0032) was confirmed to already exist from DB-002's migration 0016 (verified programmatically, same method as prior phases)
- [x] A real bug was caught and fixed while writing this phase: the cleanup function's original orphan-detection logic relied on `storage.list()`, which only lists one folder level deep and would have silently missed every file under our `{entityId}/{filename}` convention — replaced with a direct `storage.objects` query
- [x] Image processing is genuinely a no-op (returns `processed: false`), not a simulated success — per the explicit "do not implement, extension points only" instruction
- [x] Signed-URL revocation is implemented honestly as a real delete, with the underlying Supabase limitation (no per-URL revoke) documented rather than papered over
- [ ] **Not verified in this environment**: no network access (same confirmed limitation as every prior phase) — `npm install`, the actual Edge Function deployment, and a live run of the cleanup job all need to happen against a real Supabase project before this is production-verified.

## Stop point

STORE-001 is complete. Per your instruction, stopping here — not starting Edge Functions, Wallet, Escrow, Challenges, or Tournaments until you approve.
