import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * ESLint config for ChampionsStake (apps/web only).
 *
 * `no-explicit-any` and `no-floating-promises` are set to `error` (not warn)
 * deliberately: this is a real-money platform, and an unhandled promise
 * rejection in an escrow/wallet code path is exactly the class of bug the
 * Readiness Report flagged as a production risk (Critical #2, #5). Silent
 * `any` usage would also defeat the strict TypeScript config in tsconfig.json.
 *
 * TYPED LINTING: `no-floating-promises` requires actual type information
 * (it needs to know whether an expression's type extends `Promise<any>`) —
 * without a `parserOptions` block telling `@typescript-eslint/parser` which
 * tsconfig to build a type-checked program from, the rule has no types to
 * inspect and fails to load with "Parser options do not provide type
 * information." `projectService: true` is the current (typescript-eslint
 * v8, matching the pinned package.json version) recommended mechanism —
 * it replaces the older `parserOptions.project: "./tsconfig.json"` pattern
 * with automatic, per-file tsconfig discovery.
 *
 * SCOPE: this file lives at apps/web/eslint.config.mjs and is only ever
 * invoked with apps/web/ as its working directory (see the root
 * package.json's `lint` script). The Supabase Edge Functions
 * (supabase/functions/, Deno) live two directories up from here and are
 * structurally unreachable by this config's own file globbing — no
 * `ignores` entry is needed for them, unlike the earlier single-repo
 * layout, because physical separation enforces the boundary instead of a
 * config exclusion that has to be independently verified every time.
 */
const eslintConfig = [
  // Phase 8: raw `eslint .` (this repo's lint script) does not get
  // Next.js's built-in .next/ exclusion the way `next lint` would --
  // that's only applied by the Next CLI wrapper, not by loading
  // next/core-web-vitals as a flat-config preset. Discovered when a local
  // `npm run build` (needed to validate a change) left a .next/ directory
  // behind and the next `npm run lint` tried to lint Next's own generated
  // type-checking shims inside it.
  // Phase 8.5: upgrading Next 15.1.0 -> 15.5.23 (dependency-vulnerability
  // fix) changed next-env.d.ts's own generated content to include a third
  // triple-slash reference (./.next/types/routes.d.ts, for typed routes).
  // That file is Next's own build output, regenerated on every dev/build
  // run and explicitly marked "should not be edited" -- excluding it from
  // lint is the standard fix (not a project-specific relaxation), the same
  // class of exclusion as .next/** itself, just for the one generated file
  // that happens to live outside that directory.
  { ignores: [".next/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];

export default eslintConfig;
