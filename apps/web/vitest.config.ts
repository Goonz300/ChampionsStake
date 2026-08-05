import path from "node:path";
import { defineConfig } from "vitest/config";

// Pre-existing config gap, fixed here: tsconfig.json's "@/*": ["./*"] path
// mapping was never mirrored into vitest's own module resolution, so any
// test file whose import graph reaches an unmocked "@/..." specifier fails
// to load ("Failed to load url @/lib/... Does the file exist?"). Tests that
// either avoid "@/" imports entirely or fully vi.mock() them never hit this
// path, which is why it went unnoticed. Mirrors tsconfig.json exactly.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    // Placeholder-only, matching ci.yml's build job exactly -- clientEnv
    // (lib/env.ts) is evaluated eagerly at import time, so any test file
    // whose module graph reaches lib/supabase/{client,server,middleware}.ts
    // without itself managing these vars (e.g. env.test.ts's own beforeEach
    // does, and takes precedence) needs them present just to load. Deliberately
    // does NOT set SUPABASE_SERVICE_ROLE_KEY/RESEND_API_KEY here -- those are
    // lazily evaluated (serverEnv), and env.test.ts's own tests specifically
    // assert serverEnv throws when they're absent; setting them globally
    // would break that coverage.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder",
      NEXT_PUBLIC_APP_URL: "https://placeholder.championsstake.app",
    },
  },
});
