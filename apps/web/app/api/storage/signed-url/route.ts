import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFileMetadata, generateSignedDownloadUrl } from "@/lib/storage/service";
import type { StorageBucket } from "@/lib/storage/config";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  fileId: z.string().uuid(),
  expiresInSeconds: z.number().int().positive().max(86400).optional(),
});

/**
 * POST /api/storage/signed-url
 * Issues a temporary signed download URL. Authorization is enforced by
 * fetching the file_uploads row through the caller's own RLS-respecting
 * client first (migration 0032's policies) — if the row comes back null,
 * the caller was never allowed to see it, regardless of what fileId they
 * guessed.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "A valid fileId is required." } },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
      { status: 401 },
    );
  }

  let metadata;
  try {
    metadata = await getFileMetadata(parsed.data.fileId);
  } catch {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "File not found or you don't have access to it." } },
      { status: 404 },
    );
  }

  if (metadata.status !== "active") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "This file is not currently available." } },
      { status: 404 },
    );
  }

  const signedUrl = await generateSignedDownloadUrl(
    metadata.bucket as StorageBucket,
    metadata.storage_path,
    parsed.data.expiresInSeconds ?? 3600,
  );

  return NextResponse.json({ data: { signed_url: signedUrl, expires_in_seconds: parsed.data.expiresInSeconds ?? 3600 } });
}
