"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/marketing/Logo";

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "#platform", label: "Platform" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#about", label: "About" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Public marketing nav for "/". Visually and structurally independent from
 * components/landing/Navbar.tsx (which is now unused, see MarketingPage.tsx)
 * -- no shared classes, no shared tokens.
 */
export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMenuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        isScrolled
          ? "border-vv-divider bg-vv-black/85 backdrop-blur-md"
          : "border-transparent bg-transparent"
      }`}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8"
      >
        <Logo />

        <ul className="hidden items-center gap-9 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="mkt-focus-ring font-exo text-vv-text-secondary hover:text-vv-neon-green text-[13px] font-medium transition-colors"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/login"
            className="mkt-focus-ring font-exo text-vv-text-secondary px-3 py-2 text-[13px] font-medium transition-colors hover:text-white"
          >
            Log In
          </Link>
          <Link
            href="/register"
            className="mkt-focus-ring bg-vv-neon-green text-vv-black font-exo rounded-md px-4 py-2 text-[13px] font-bold transition-opacity hover:opacity-90"
          >
            Explore Platform
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          aria-expanded={isMenuOpen}
          aria-controls="mkt-mobile-menu"
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          className="mkt-focus-ring mkt-border flex h-9 w-9 items-center justify-center rounded-md text-white lg:hidden"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className="h-4 w-4"
          >
            {isMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </nav>

      <div
        id="mkt-mobile-menu"
        className={`overflow-hidden border-t border-vv-divider bg-vv-black transition-[max-height,opacity] duration-300 lg:hidden ${
          isMenuOpen ? "max-h-[24rem] opacity-100" : "max-h-0 border-t-0 opacity-0"
        }`}
      >
        <ul className="flex flex-col gap-1 px-5 py-4">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="mkt-focus-ring font-exo text-vv-text-secondary hover:text-vv-neon-green block rounded-md px-2 py-3 text-[15px] font-medium"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 px-5 pb-6 pt-2">
          <Link
            href="/login"
            className="mkt-focus-ring mkt-border rounded-md px-5 py-3 text-center text-[14px] font-semibold text-white"
          >
            Log In
          </Link>
          <Link
            href="/register"
            className="mkt-focus-ring bg-vv-neon-green text-vv-black font-exo rounded-md px-5 py-3 text-center text-[14px] font-bold transition-opacity hover:opacity-90"
          >
            Explore Platform
          </Link>
        </div>
      </div>
    </header>
  );
}
