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
    <main className="bg-vv-black flex min-h-screen items-center justify-center p-4">
      <div className="border-vv-divider bg-vv-surface w-full max-w-md rounded-lg border p-8 shadow-xl">
        <h1 className="font-orbitron text-vv-neon-green text-center text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="font-exo text-vv-text-secondary mt-2 text-center text-sm">{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
