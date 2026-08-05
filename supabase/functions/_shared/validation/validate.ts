// supabase/functions/_shared/validation/validate.ts

import type { z } from "zod";
import { ValidationError } from "../errors/index.ts";

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.";
}

export function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error), {
      issues: result.error.issues,
    });
  }
  return result.data;
}

export function validateQuery<T extends z.ZodTypeAny>(
  schema: T,
  url: URL,
): z.infer<T> {
  const params = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error), {
      issues: result.error.issues,
    });
  }
  return result.data;
}

export function validatePathParams<T extends z.ZodTypeAny>(
  schema: T,
  params: unknown,
): z.infer<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error), {
      issues: result.error.issues,
    });
  }
  return result.data;
}

export function validateHeaders<T extends z.ZodTypeAny>(
  schema: T,
  request: Request,
): z.infer<T> {
  const headers = Object.fromEntries(request.headers.entries());
  const result = schema.safeParse(headers);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error), {
      issues: result.error.issues,
    });
  }
  return result.data;
}

/** Parses the request body as JSON, raising a consistent ValidationError
 * (rather than an uncaught SyntaxError) on malformed JSON. */
export async function parseJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Request body is not valid JSON.");
  }
}
