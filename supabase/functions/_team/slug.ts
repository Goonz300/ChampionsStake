// supabase/functions/_team/slug.ts
//
// Pure logic, deliberately kept out of service.ts: that module
// instantiates getServiceRoleClient() at top level (this codebase's
// established pattern, e.g. _ai/trust-score.ts), which throws immediately
// in a test environment with no live Supabase env vars set. Every other
// *-heuristics.ts module in this codebase exists for the same reason --
// pure functions need to live somewhere importable without a DB client.

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
