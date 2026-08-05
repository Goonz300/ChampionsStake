// supabase/functions/_shared/response/index.ts

import { toEdgeFunctionError } from "../errors/index.ts";
import { securityHeaders } from "../security/headers.ts";

const BASE_HEADERS = {
  "Content-Type": "application/json",
  ...securityHeaders,
};

export function successResponse<T>(
  data: T,
  init?: { status?: number; headers?: HeadersInit },
): Response {
  return new Response(JSON.stringify({ data }), {
    status: init?.status ?? 200,
    headers: { ...BASE_HEADERS, ...(init?.headers ?? {}) },
  });
}

export interface PaginationMeta {
  next_cursor: string | null;
  total_count?: number;
}

export function paginatedResponse<T>(
  data: T[],
  meta: PaginationMeta,
  init?: { status?: number },
): Response {
  return new Response(JSON.stringify({ data, meta }), {
    status: init?.status ?? 200,
    headers: BASE_HEADERS,
  });
}

export function errorResponse(err: unknown, requestId?: string): Response {
  const edgeError = toEdgeFunctionError(err);
  const body = edgeError.toResponseBody();
  if (requestId) {
    (body.error as Record<string, unknown>).request_id = requestId;
  }

  const headers: Record<string, string> = { ...BASE_HEADERS };
  if ("retryAfterSeconds" in edgeError) {
    headers["Retry-After"] = String(
      (edgeError as { retryAfterSeconds: number }).retryAfterSeconds,
    );
  }

  return new Response(JSON.stringify(body), {
    status: edgeError.httpStatus,
    headers,
  });
}

/**
 * Streaming response helper — for future functions that need to proxy a
 * long-running or chunked result (e.g. a large export). Framework-only: no
 * current function uses this, but the shape is established so a future one
 * doesn't need to invent its own streaming convention.
 */
export function streamingResponse(
  stream: ReadableStream,
  contentType = "application/octet-stream",
): Response {
  return new Response(stream, {
    status: 200,
    headers: { ...BASE_HEADERS, "Content-Type": contentType },
  });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204, headers: securityHeaders });
}
