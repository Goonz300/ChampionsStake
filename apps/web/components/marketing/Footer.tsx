import Link from "next/link";
import { Logo } from "@/components/marketing/Logo";

const FOOTER_COLUMNS: Array<{ heading: string; links: Array<{ href: string; label: string }> }> = [
  {
    heading: "Platform",
    links: [
      { href: "#platform", label: "The Concept" },
      { href: "#how-it-works", label: "How It Works" },
      { href: "#about", label: "About" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/register", label: "Create Account" },
      { href: "/login", label: "Log In" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms & Conditions" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/cookies", label: "Cookie Policy" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-vv-divider border-t px-5 pb-10 pt-16 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="text-vv-text-tertiary mt-4 max-w-xs text-sm leading-relaxed">
              A platform for structured competitions, challenges, and performance-driven
              participation.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading}>
              <h3 className="font-mono text-vv-text-tertiary text-[10px] font-semibold uppercase tracking-widest">
                {column.heading}
              </h3>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {/* Plain <a>: this list mixes real routes with same-page
                        "#section" anchors, and Next's typedRoutes can only
                        validate the former. */}
                    <a
                      href={link.href}
                      className="mkt-focus-ring text-vv-text-secondary hover:text-vv-neon-green text-sm transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-vv-divider mt-14 flex flex-col items-center justify-between gap-4 border-t pt-8 sm:flex-row">
          <p className="text-vv-text-tertiary text-xs">
            &copy; {year} ChampionsStake. All rights reserved.
          </p>
          <Link
            href="/terms"
            className="mkt-focus-ring font-mono text-vv-text-tertiary hover:text-vv-text-secondary text-[10px] uppercase tracking-widest"
          >
            Terms &amp; Conditions
          </Link>
        </div>
      </div>
    </footer>
  );
}
