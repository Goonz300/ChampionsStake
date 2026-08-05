/**
 * Validates a candidate redirect target (typically read from a query param
 * like ?redirect_to=) and returns it as a plain, safe relative path — or
 * `fallback` if it isn't one.
 *
 * WHY THIS RETURNS `string`, NOT a typed route:
 * Next.js's `typedRoutes` (next.config.ts) makes `router.push`/`replace`
 * reject a plain `string` argument, requiring it to match a literal route
 * union generated from the real `app/` directory at build time. This
 * function's job is runtime SAFETY validation (rejecting protocol-relative
 * / off-origin targets); it cannot promise the result is a specific route
 * literal, so it stays `string` and lets the caller handle the type
 * boundary at the exact point Next's API requires it — see
 * app/(auth)/login/page.tsx.
 *
 * VERIFIED FINDING, not assumed: an earlier version of this comment
 * recommended `redirectTo as Route` (the public, unparameterized type
 * exported by `next`) as the fix, based on commonly-cited Next.js usage
 * patterns. That claim was tested directly against the real TypeScript
 * compiler using a faithful reproduction of Next's generated constraint
 * (`RouteImpl<string>`, a strict literal union) and DISPROVEN: because the
 * public `Route<T extends string = string>` type defaults its generic
 * parameter to plain `string` when used unparameterized, `as Route`
 * collapses right back to `string` and can fail to satisfy the router's
 * real constraint — reproducing the identical error instead of fixing it.
 *
 * The robust fix, verified to hold under either possible shape of Next's
 * real signature (concrete or generic): derive the assertion target
 * directly from the function being called, `Parameters<typeof
 * router.push>[0]`, rather than an independently-guessed type name. This
 * cannot mismatch by construction — it asserts to whatever the router
 * actually expects, whatever that turns out to be, instead of betting on
 * a guess about `Route`/`RouteImpl`'s exact definitions.
 */
export function getSafeRedirectPath(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (!candidate) return fallback;

  // Must start with exactly one "/" (a relative path)...
  if (!candidate.startsWith("/")) return fallback;
  // ...never "//..." (protocol-relative — browsers treat this as an absolute
  // URL using the current scheme, e.g. "//evil.com" -> "https://evil.com").
  if (candidate.startsWith("//")) return fallback;
  // ...and never contain a scheme or backslash (some browsers normalize
  // "/\evil.com" or "/\/evil.com" into a protocol-relative URL too).
  if (candidate.includes("://") || candidate.includes("\\")) return fallback;

  return candidate;
}
