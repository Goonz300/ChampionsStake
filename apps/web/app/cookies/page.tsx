import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy — ChampionsStake",
  description: "How ChampionsStake uses cookies and similar session data.",
};

const SECTIONS: Array<{ heading: string; body: React.ReactNode }> = [
  {
    heading: "1. What This Page Covers",
    body: (
      <p>
        This is a placeholder Cookie Policy. It describes, in plain terms, the cookies
        ChampionsStake currently uses. A complete, formally drafted Cookie Policy has not yet been
        published — this page will be replaced with that document when it is ready.
      </p>
    ),
  },
  {
    heading: "2. Cookies We Use",
    body: (
      <p>
        ChampionsStake uses a small number of strictly necessary cookies to keep you signed in and
        to protect your session — for example, recognizing your browser across requests so we can
        enforce multi-factor authentication and detect suspicious login activity. These cookies are
        essential to operating the service.
      </p>
    ),
  },
  {
    heading: "3. What We Don't Use",
    body: (
      <p>
        We do not use cookies for third-party advertising, and we do not use cookies for cross-site
        tracking.
      </p>
    ),
  },
  {
    heading: "4. Managing Cookies",
    body: (
      <p>
        Most browsers let you block or delete cookies through their settings. Because the cookies
        described above are strictly necessary for authentication, blocking them will prevent you
        from staying signed in to ChampionsStake.
      </p>
    ),
  },
  {
    heading: "5. Related Policies",
    body: (
      <p>
        See our{" "}
        <Link href="/privacy" className="text-vv-neon-green hover:opacity-80">
          Privacy Policy
        </Link>{" "}
        for how we handle personal data more broadly, and our{" "}
        <Link href="/terms" className="text-vv-neon-green hover:opacity-80">
          Terms of Service
        </Link>{" "}
        for the terms governing your use of the platform.
      </p>
    ),
  },
  {
    heading: "6. Contact",
    body: (
      <p>
        Questions about this policy can be sent to{" "}
        <a href="mailto:support@championsstake.app" className="text-vv-neon-green hover:opacity-80">
          support@championsstake.app
        </a>
        .
      </p>
    ),
  },
];

export default function CookiesPage() {
  return (
    <main className="min-h-screen bg-vv-black px-4 py-16 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mkt-focus-ring text-sm text-vv-text-secondary transition-colors hover:text-white"
        >
          &larr; Back to ChampionsStake
        </Link>

        <h1 className="font-exo mt-6 text-3xl font-black text-white sm:text-4xl">
          Cookie Policy
        </h1>
        <p className="mt-2 text-sm text-vv-text-tertiary">
          Last updated: 2026 &middot; Placeholder — a complete Cookie Policy has not yet been
          published.
        </p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed text-vv-text-secondary">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-exo mb-3 text-lg font-bold text-white">{section.heading}</h2>
              {section.body}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
