import type { ReactNode } from "react";

/**
 * Shared visual shell for every auth page. Reuses the exact design tokens
 * from tailwind.config.ts (colors/fonts copied verbatim from the approved
 * prototype) — this is a structural adaptation of the prototype's auth
 * *modal* into a routed *page* (required by moving from a static SPA to
 * Next.js App Router), not a visual redesign.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-vv-black p-4">
      <div className="w-full max-w-md rounded-lg border border-vv-divider bg-vv-surface p-8 shadow-xl">
        <h1 className="font-orbitron text-center text-2xl font-bold text-vv-neon-green">
          {title}
        </h1>
        {subtitle && (
          <p className="font-exo mt-2 text-center text-sm text-vv-text-secondary">{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
