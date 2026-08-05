import { createHash } from "node:crypto";
import { BUCKET_CONFIG, type StorageBucket } from "@/lib/storage/config";

export class FileValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "FileValidationError";
  }
}

/**
 * Magic-byte signatures for the file types this platform actually accepts.
 * This is deliberately narrow (not a general-purpose file-type sniffer) —
 * its only job is to catch the common "renamed .exe to .png" class of
 * corrupt/malicious upload. It does not replace virus scanning; see
 * lib/storage/image-processing.ts for that extension point.
 */
const MAGIC_BYTES: Record<string, { bytes: number[]; offset: number }[]> = {
  "image/jpeg": [{ bytes: [0xff, 0xd8, 0xff], offset: 0 }],
  "image/png": [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 }],
  "image/webp": [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }], // "RIFF" header
  "application/pdf": [{ bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }], // "%PDF"
  "video/mp4": [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }], // "ftyp" at offset 4
  "audio/mpeg": [{ bytes: [0x49, 0x44, 0x33], offset: 0 }], // ID3 tag (most real-world mp3s)
};

function matchesMagicBytes(buffer: Uint8Array, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) {
    // No signature registered for this MIME type (e.g. audio/mp4, video/quicktime,
    // image/svg+xml, audio/webm) — skip the check rather than falsely reject.
    return true;
  }
  return signatures.some((sig) => sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte));
}

/**
 * Sanitizes a user-supplied filename: strips path separators (path
 * traversal prevention), collapses unsafe characters, and caps length. The
 * sanitized name is used only for display/original_filename bookkeeping —
 * the actual storage path is always server-generated (see
 * lib/storage/service.ts's buildStoragePath), never derived from client
 * input, which is the real path-traversal defense.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "unnamed";
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "unnamed";
}

export function computeChecksum(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface ValidateUploadInput {
  bucket: StorageBucket;
  mimeType: string;
  sizeBytes: number;
  buffer: Uint8Array;
}

/**
 * Validates a proposed upload against its bucket's rules. Throws
 * FileValidationError with a specific code on the first failure. This is
 * the ONE function every upload path (lib/storage/service.ts) must call
 * before touching the Storage API — never trust a client's self-reported
 * mime_type/size without this check running server-side.
 */
export function validateUpload(input: ValidateUploadInput): void {
  const config = BUCKET_CONFIG[input.bucket];

  if (!config.allowedMimeTypes.includes(input.mimeType)) {
    throw new FileValidationError(
      "VALIDATION_ERROR",
      `File type "${input.mimeType}" is not allowed in bucket "${input.bucket}". Allowed: ${config.allowedMimeTypes.join(", ")}.`,
    );
  }

  if (input.sizeBytes <= 0) {
    throw new FileValidationError("VALIDATION_ERROR", "File is empty.");
  }

  if (input.sizeBytes > config.maxSizeBytes) {
    throw new FileValidationError(
      "VALIDATION_ERROR",
      `File exceeds the ${(config.maxSizeBytes / (1024 * 1024)).toFixed(0)}MB limit for bucket "${input.bucket}".`,
    );
  }

  if (!matchesMagicBytes(input.buffer, input.mimeType)) {
    throw new FileValidationError(
      "VALIDATION_ERROR",
      "File content does not match its declared type (failed signature check) — the file may be corrupt or mislabeled.",
    );
  }
}
