import { randomUUID } from "node:crypto";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { BUCKET_CONFIG, type StorageBucket } from "@/lib/storage/config";
import {
  validateUpload,
  sanitizeFilename,
  computeChecksum,
  FileValidationError,
} from "@/lib/storage/validation";
import { noopImageProcessor } from "@/lib/storage/image-processing";

/**
 * DESIGN NOTE: every function here runs server-side (Route Handlers only —
 * never import this from a "use client" file). Uploads are NOT performed by
 * having the browser call Supabase Storage directly, even though
 * storage.objects RLS (migrations 0026/0030) would technically allow it for
 * an authorized user. Going through this service layer instead means:
 *   1. File size and MIME type are measured from the actual bytes received,
 *      never trusted from a client-supplied Content-Type/Content-Length
 *      header (this phase's "never trust client-provided metadata" rule).
 *   2. Magic-byte validation (lib/storage/validation.ts) can run before
 *      anything touches the bucket.
 *   3. The file_uploads metadata row and the actual Storage object are
 *      written in one place, so they can't drift apart the way they could
 *      if a client wrote one and a trigger tried to infer the other.
 * Authorization is still fully enforced — see checkUploadAuthorization,
 * which reuses the exact same Postgres helper functions
 * (is_challenge_participant, is_dispute_participant, etc. from DB-002
 * migration 0016) that storage.objects' own RLS policies use, via RPC
 * against the requesting user's own session. This means the authorization
 * *rule* is defined in exactly one place (the database), even though the
 * *enforcement point* for uploads is this service layer rather than RLS.
 */

interface RelatedEntity {
  table: "challenges" | "disputes" | "tournaments" | "users";
  id: string;
}

export class StorageAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageAuthorizationError";
  }
}

async function checkUploadAuthorization(
  bucket: StorageBucket,
  related: RelatedEntity,
): Promise<void> {
  const config = BUCKET_CONFIG[bucket];
  const supabase = await createClient(); // RLS-respecting, tied to the caller's session

  switch (config.pathEntityKind) {
    case "user": {
      const { data } = await supabase.auth.getUser();
      if (!data.user || data.user.id !== related.id) {
        throw new StorageAuthorizationError("You may only upload to your own folder.");
      }
      return;
    }
    case "challenge": {
      const { data, error } = await supabase.rpc("is_challenge_participant", {
        p_challenge_id: related.id,
      });
      if (error || !data) {
        throw new StorageAuthorizationError("You are not a participant in this challenge.");
      }
      return;
    }
    case "dispute": {
      const { data, error } = await supabase.rpc("can_submit_proof", { p_dispute_id: related.id });
      if (error || !data) {
        throw new StorageAuthorizationError(
          "You may not submit evidence for this dispute right now.",
        );
      }
      return;
    }
    case "tournament": {
      const { data, error } = await supabase.rpc("is_admin", {});
      if (error || !data) {
        throw new StorageAuthorizationError("Only administrators may upload tournament assets.");
      }
      return;
    }
    case "category": {
      const { data, error } = await supabase.rpc("is_admin", {});
      if (error || !data) {
        throw new StorageAuthorizationError("Only administrators may upload system assets.");
      }
      return;
    }
  }
}

function buildStoragePath(
  bucket: StorageBucket,
  folderSegment: string,
  sanitizedFilename: string,
): string {
  // The folder segment (user/challenge/dispute/tournament id, or a fixed
  // admin-chosen category for system-assets) is always server-validated
  // above BEFORE this is called. The filename component is always a fresh
  // UUID prefix + the sanitized original name — never the raw client path —
  // which is the actual path-traversal defense (sanitizeFilename alone
  // strips traversal characters, but a server-generated prefix means even a
  // filename collision can never overwrite another user's object).
  return `${folderSegment}/${randomUUID()}-${sanitizedFilename}`;
}

export interface UploadFileInput {
  bucket: StorageBucket;
  related: RelatedEntity;
  file: Buffer;
  mimeType: string;
  originalFilename: string;
  visibility?: "public" | "private";
}

export interface UploadFileResult {
  fileUploadId: string;
  storagePath: string;
  bucket: StorageBucket;
}

export async function uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
  await checkUploadAuthorization(input.bucket, input.related);

  validateUpload({
    bucket: input.bucket,
    mimeType: input.mimeType,
    sizeBytes: input.file.byteLength,
    buffer: input.file,
  });

  const checksum = computeChecksum(input.file);
  const sanitizedName = sanitizeFilename(input.originalFilename);
  const storagePath = buildStoragePath(input.bucket, input.related.id, sanitizedName);

  const admin = createServiceRoleClient();

  const { error: uploadError } = await admin.storage
    .from(input.bucket)
    .upload(storagePath, input.file, { contentType: input.mimeType, upsert: false });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // Extension point: a real image processor would run here (resize/thumbnail/
  // scan) before the row is marked 'active'. See lib/storage/image-processing.ts.
  const scanResult = await noopImageProcessor.scanForThreats(storagePath);

  const { data: row, error: insertError } = await admin
    .from("file_uploads")
    .insert({
      owner_id: await getRequestingUserId(),
      bucket: input.bucket,
      storage_path: storagePath,
      mime_type: input.mimeType,
      file_size_bytes: input.file.byteLength,
      checksum_sha256: checksum,
      related_table: input.related.table,
      related_id: input.related.id,
      visibility: input.visibility ?? (BUCKET_CONFIG[input.bucket].public ? "public" : "private"),
      status: scanResult.clean ? "active" : "quarantined",
      original_filename: sanitizedName,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    // Roll back the storage object if metadata insert fails, so the two
    // never drift apart (an orphaned storage object with no metadata row
    // would otherwise be invisible to every query in this codebase).
    await admin.storage.from(input.bucket).remove([storagePath]);
    throw new Error(`Failed to record upload metadata: ${insertError?.message}`);
  }

  return { fileUploadId: row.id as string, storagePath, bucket: input.bucket };
}

async function getRequestingUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new StorageAuthorizationError("Not authenticated.");
  return user.id;
}

export async function generateSignedDownloadUrl(
  bucket: StorageBucket,
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data) {
    throw new Error(`Failed to create signed URL: ${error?.message}`);
  }
  return data.signedUrl;
}

/**
 * Refreshing a signed URL is just issuing a new one — Supabase Storage does
 * not support extending an existing signed URL's expiry in place. Callers
 * that need a "refresh" semantics should simply call this again.
 */
export const refreshSignedDownloadUrl = generateSignedDownloadUrl;

export async function generateSignedUploadUrl(
  bucket: StorageBucket,
  related: RelatedEntity,
  sanitizedFilename: string,
): Promise<{ signedUrl: string; storagePath: string; token: string }> {
  await checkUploadAuthorization(bucket, related);

  const storagePath = buildStoragePath(bucket, related.id, sanitizeFilename(sanitizedFilename));
  const admin = createServiceRoleClient();

  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(`Failed to create signed upload URL: ${error?.message}`);
  }

  return { signedUrl: data.signedUrl, storagePath, token: data.token };
}

/**
 * "Revoking" a signed URL: Supabase Storage signed URLs cannot be
 * individually invalidated before their expiry — the only real revocation
 * mechanisms are (a) deleting the underlying object, or (b) rotating the
 * bucket's signing key project-wide (which invalidates every outstanding
 * signed URL for every bucket, not a targeted revocation). This function is
 * honest about that rather than pretending a per-URL revoke exists: it
 * revokes access by deleting the object, which is the correct response to
 * "this specific file must no longer be downloadable," but is not a no-op
 * revoke — the file is genuinely gone.
 */
export async function revokeFileAccess(bucket: StorageBucket, storagePath: string): Promise<void> {
  await deleteFile(bucket, storagePath);
}

export async function deleteFile(bucket: StorageBucket, storagePath: string): Promise<void> {
  const admin = createServiceRoleClient();

  const { error: storageError } = await admin.storage.from(bucket).remove([storagePath]);
  if (storageError) {
    throw new Error(`Failed to delete storage object: ${storageError.message}`);
  }

  await admin
    .from("file_uploads")
    .update({ status: "deleted", deleted_at: new Date().toISOString() })
    .eq("bucket", bucket)
    .eq("storage_path", storagePath);
}

export async function replaceFile(
  bucket: StorageBucket,
  existingStoragePath: string,
  newFile: Buffer,
  mimeType: string,
  originalFilename: string,
  related: RelatedEntity,
): Promise<UploadFileResult> {
  // "Replace" is modeled as delete-then-upload rather than an in-place
  // overwrite, consistent with every immutability rule elsewhere in this
  // schema (chat messages, dispute evidence, etc. are never edited in
  // place) — a replaced avatar, for instance, still leaves an auditable
  // trail of the prior file_uploads row rather than silently overwriting it.
  await deleteFile(bucket, existingStoragePath);
  return uploadFile({ bucket, related, file: newFile, mimeType, originalFilename });
}

export async function listUserFiles(bucket: StorageBucket, ownerId: string) {
  const supabase = await createClient(); // RLS-respecting: caller can only see their own via file_uploads_select_own
  const { data, error } = await supabase
    .from("file_uploads")
    .select("id, storage_path, mime_type, file_size_bytes, status, created_at, original_filename")
    .eq("bucket", bucket)
    .eq("owner_id", ownerId)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list files: ${error.message}`);
  return data;
}

export async function getFileMetadata(fileUploadId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("file_uploads")
    .select("*")
    .eq("id", fileUploadId)
    .single();

  if (error) throw new Error(`Failed to fetch file metadata: ${error.message}`);
  return data;
}

async function getFileMetadataByPath(bucket: StorageBucket, storagePath: string) {
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("file_uploads")
    .select("*")
    .eq("bucket", bucket)
    .eq("storage_path", storagePath)
    .single();

  if (error || !data)
    throw new Error(`Failed to fetch file metadata for ${storagePath}: ${error?.message}`);
  return data;
}

/**
 * Moving/copying is scoped to the same bucket only — moving a file between
 * buckets (e.g. proof-images -> tournament-assets) would bypass that
 * bucket's own size/MIME/retention rules, so it's intentionally not
 * supported here. Both operations re-run authorization for the destination
 * entity, since "I could upload the original" does not imply "I may place
 * it under this new challenge/dispute."
 */
export async function moveFile(
  bucket: StorageBucket,
  fromPath: string,
  toRelated: RelatedEntity,
  filename: string,
): Promise<string> {
  await checkUploadAuthorization(bucket, toRelated);

  const toPath = buildStoragePath(bucket, toRelated.id, sanitizeFilename(filename));
  const admin = createServiceRoleClient();

  const { error } = await admin.storage.from(bucket).move(fromPath, toPath);
  if (error) throw new Error(`Failed to move file: ${error.message}`);

  await admin
    .from("file_uploads")
    .update({ storage_path: toPath, related_table: toRelated.table, related_id: toRelated.id })
    .eq("bucket", bucket)
    .eq("storage_path", fromPath);

  return toPath;
}

export async function copyFile(
  bucket: StorageBucket,
  fromPath: string,
  toRelated: RelatedEntity,
  filename: string,
): Promise<UploadFileResult> {
  await checkUploadAuthorization(bucket, toRelated);

  const toPath = buildStoragePath(bucket, toRelated.id, sanitizeFilename(filename));
  const admin = createServiceRoleClient();

  const { error } = await admin.storage.from(bucket).copy(fromPath, toPath);
  if (error) throw new Error(`Failed to copy file: ${error.message}`);

  const original = await getFileMetadataByPath(bucket, fromPath);

  const { data: row, error: insertError } = await admin
    .from("file_uploads")
    .insert({
      owner_id: await getRequestingUserId(),
      bucket,
      storage_path: toPath,
      mime_type: original.mime_type,
      file_size_bytes: original.file_size_bytes,
      checksum_sha256: original.checksum_sha256,
      related_table: toRelated.table,
      related_id: toRelated.id,
      visibility: original.visibility,
      status: "active",
      original_filename: original.original_filename,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    await admin.storage.from(bucket).remove([toPath]);
    throw new Error(`Failed to record copied file metadata: ${insertError?.message}`);
  }

  return { fileUploadId: row.id as string, storagePath: toPath, bucket };
}

export { FileValidationError };
