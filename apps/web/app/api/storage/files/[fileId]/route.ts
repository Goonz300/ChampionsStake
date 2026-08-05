import { NextResponse, type NextRequest } from "next/server";
import { getFileMetadata, deleteFile } from "@/lib/storage/service";
import type { StorageBucket } from "@/lib/storage/config";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/storage/files/:fileId — metadata only. RLS on file_uploads
 * (migration 0032) is what actually restricts this to the owner or staff;
 * this route just surfaces a 404 rather than a raw empty-row response when
 * RLS filters the row out.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;

  try {
    const metadata = await getFileMetadata(fileId);
    return NextResponse.json({ data: metadata });
  } catch {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "File not found." } },
      { status: 404 },
    );
  }
}

/**
 * DELETE /api/storage/files/:fileId
 * Authorization: only the uploader, or staff, may delete — enforced here
 * (not solely by storage RLS, since deletion also needs to update
 * file_uploads.status, which goes through the service-role client).
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
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
    metadata = await getFileMetadata(fileId);
  } catch {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "File not found." } }, { status: 404 });
  }

  const { data: isStaff } = await supabase.rpc("is_admin", {});
  if (metadata.owner_id !== user.id && !isStaff) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "You may not delete this file." } },
      { status: 403 },
    );
  }

  await deleteFile(metadata.bucket as StorageBucket, metadata.storage_path);

  return NextResponse.json({ data: { deleted: true } });
}
