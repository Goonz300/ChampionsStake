import Link from "next/link";

/**
 * Phase 8: no shared nav/sidebar component existed anywhere in this repo
 * before this phase (confirmed by audit) -- every page rendered standalone.
 * This is a minimal, additive nav for the new tournament-platform pages
 * only; existing pages (dashboard, settings) are left untouched rather than
 * retrofitted, matching "never redesign the application."
 */
const LINKS = [
  { href: "/tournaments", label: "Tournaments" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/teams", label: "Teams" },
  { href: "/leagues", label: "Leagues" },
  { href: "/organizer", label: "Organizer" },
] as const;

export function TournamentNav({ active }: { active?: string }) {
  return (
    <nav className="border-vv-divider mb-6 flex gap-4 border-b pb-3">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={
            active === link.href
              ? "font-exo text-vv-neon-green text-sm font-semibold"
              : "font-exo text-vv-text-secondary text-sm hover:text-white"
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
