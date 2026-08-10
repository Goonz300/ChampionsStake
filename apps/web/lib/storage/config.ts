/**
 * Bucket configuration mirrored from supabase/migrations/0030 and 0031's
 * storage_bucket_name enum. Kept as a single TypeScript source of truth so
 * validation logic (here) and the SQL bucket definitions never drift apart
 * silently — if you add a bucket in SQL, add it here too, or the type
 * system will flag every switch/map that's missing a case.
 */

export type StorageBucket =
  | "avatars"
  | "challenge-media"
  | "proof-images"
  | "proof-videos"
  | "chat-media"
  | "voice-notes"
  | "kyc-documents"
  | "tournament-assets"
  | "system-assets";

export interface BucketConfig {
  maxSizeBytes: number;
  allowedMimeTypes: readonly string[];
  /** How the first path segment (storage.foldername(name)[1]) should be interpreted. */
  pathEntityKind: "user" | "challenge" | "dispute" | "tournament" | "category";
  public: boolean;
  /** Business-rules-driven retention window, or null for "kept indefinitely". */
  retentionDays: number | null;
}

export const BUCKET_CONFIG: Record<StorageBucket, BucketConfig> = {
  avatars: {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    pathEntityKind: "user",
    public: true,
    retentionDays: null,
  },
  "challenge-media": {
    maxSizeBytes: 100 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4"],
    pathEntityKind: "challenge",
    public: false,
    retentionDays: 365, // Business Rules §8 chat/media retention
  },
  "proof-images": {
    maxSizeBytes: 20 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    pathEntityKind: "dispute",
    public: false,
    retentionDays: null, // dispute evidence retained indefinitely (appeal window + compliance)
  },
  "proof-videos": {
    maxSizeBytes: 200 * 1024 * 1024,
    allowedMimeTypes: ["video/mp4", "video/quicktime"],
    pathEntityKind: "dispute",
    public: false,
    retentionDays: null,
  },
  "chat-media": {
    maxSizeBytes: 100 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4"],
    pathEntityKind: "challenge",
    public: false,
    retentionDays: 365,
  },
  "voice-notes": {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/webm"],
    pathEntityKind: "challenge",
    public: false,
    retentionDays: 365,
  },
  "kyc-documents": {
    maxSizeBytes: 20 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
    pathEntityKind: "user",
    public: false,
    retentionDays: null, // compliance retention, never auto-deleted
  },
  "tournament-assets": {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    pathEntityKind: "tournament",
    public: true,
    retentionDays: null,
  },
  "system-assets": {
    // Phase 8.5 hostile-review fix: image/svg+xml removed. Nothing in this
    // codebase sanitizes SVG content (image-processing.ts's threat scanner
    // is an honest no-op), and this bucket is public -- an admin-uploaded
    // SVG containing <script> would execute if a browser navigated to it
    // directly. See migration 0107 for the matching Storage-level fix.
    maxSizeBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    pathEntityKind: "category",
    public: true,
    retentionDays: null,
  },
};
