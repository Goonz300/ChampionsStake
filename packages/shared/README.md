# @championsstake/shared

**Currently empty, deliberately, not as an oversight.**

Across every implementation phase of this project, `apps/web` (Next.js/Node) and `supabase/functions` (Deno Edge Functions) were built with zero code sharing between them — verified multiple times by exhaustive import-graph analysis (see `docs/BUILD_VERIFICATION_REPORT.md`): no file in the Next.js app has ever imported anything from the Edge Functions tree, or vice versa. Money-moving logic, RLS, and business rules live once, in `supabase/functions/_wallet`, `_challenge`, `_tournament`, etc., and the Next.js app talks to them exclusively over HTTP (calling the deployed Edge Functions), never by importing their source.

This package exists because the requested architecture calls for a `packages/shared` location, and because a genuine future candidate for it is easy to name: TypeScript types describing the JSON shape of API requests/responses (so `apps/web` and `supabase/functions` can't silently drift on a field name). That type-sharing was never built in any phase — adding it now, speculatively, without a concrete consumer on both sides, would be exactly the kind of placeholder/speculative code every phase of this project has deliberately avoided. When a real shared-type need arises, it belongs here.
