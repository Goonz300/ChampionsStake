// supabase/functions/_shared/validation/schemas.ts

import { z } from "npm:zod@3.24.1";
import { config } from "../config/index.ts";

export const uuidSchema = z.string().uuid();

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(config.pagination.maxPageSize)
    .default(config.pagination.defaultPageSize),
});

export const isoDateSchema = z.string().datetime({ offset: true });

export const dateRangeSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || new Date(v.from) <= new Date(v.to), {
    message: "`from` must be before or equal to `to`.",
  });

/** Builds a Zod enum schema from a readonly string-literal array, for
 * consistent "one of these exact values" validation across every function. */
export function enumSchema<T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values);
}

export const idempotencyKeyHeaderSchema = z.string().uuid();

export const moneyAmountCentsSchema = z.number().int().positive();
