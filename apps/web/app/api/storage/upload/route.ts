import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { uploadFile, StorageAuthorizationError, FileValidationError } from "@/lib/storage/service";
import type { StorageBucket } from "@/lib/storage/config";
import { BUCKET_CONFIG } from "@/lib/storage/config";

const relatedTableSchema = z.enum(["challenges", "disputes", "tournaments", "users"]);
const bucketSchema = z.enum([
  "avatars",
  "challenge-media",
  "proof-images",
  "proof-videos",
  "chat-media",
  "voice-notes",
  "kyc-documents",
  "tournament-assets",
  "system-assets",
]);

/**
 * POST /api/storage/upload (multipart/form-data)
 * Fields: bucket, relatedTable, relatedId, file
 *
 * This is the ONE HTTP entry point for uploads across every bucket — the
 * per-feature endpoints in the API Specification (e.g.
 * "POST /challenges/:id/chat/media", "POST /disputes/:id/evidence") are
 * expected to call uploadFile() directly from lib/storage/service.ts (or
 * proxy to this route) rather than reimplement validation/authorization,
 * so there is exactly one place those rules live.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Expected multipart/form-data." } },
      { status: 400 },
    );
  }

  const bucketRaw = formData.get("bucket");
  const relatedTableRaw = formData.get("relatedTable");
  const relatedId = formData.get("relatedId");
  const file = formData.get("file");

  const bucketParsed = bucketSchema.safeParse(bucketRaw);
  const relatedTableParsed = relatedTableSchema.safeParse(relatedTableRaw);

  if (
    !bucketParsed.success ||
    !relatedTableParsed.success ||
    typeof relatedId !== "string" ||
    !(file instanceof File)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "bucket, relatedTable, relatedId, and file are all required.",
        },
      },
      { status: 400 },
    );
  }

  const bucket: StorageBucket = bucketParsed.data;
  const config = BUCKET_CONFIG[bucket];

  if (file.size > config.maxSizeBytes) {
    return NextResponse.json(
      {
        error: { code: "VALIDATION_ERROR", message: `File exceeds the size limit for ${bucket}.` },
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await uploadFile({
      bucket,
      related: { table: relatedTableParsed.data, id: relatedId },
      file: buffer,
      mimeType: file.type,
      originalFilename: file.name,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageAuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: err.message } },
        { status: 403 },
      );
    }
    if (err instanceof FileValidationError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Upload failed." } },
      { status: 500 },
    );
  }
}
