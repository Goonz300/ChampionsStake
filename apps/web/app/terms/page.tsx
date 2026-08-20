import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — ChampionsStake",
  description: "The terms governing use of the ChampionsStake platform.",
};

const SECTIONS: Array<{ heading: string; body: React.ReactNode }> = [
  {
    heading: "1. What ChampionsStake Is",
    body: (
      <p>
        ChampionsStake is a competitive gaming marketplace. Players stake funds into an
        escrow-protected wallet, agree on the terms of a head-to-head challenge or tournament, and
        compete in a skill-based match. The outcome of every match is determined by the
        players&apos; performance in the underlying game — not by chance, and not by any
        randomization controlled by the platform. By creating an account, you agree to these Terms.
      </p>
    ),
  },
  {
    heading: "2. Eligibility",
    body: (
      <p>
        You must be at least 18 years old, or the age of majority in your jurisdiction if higher, to
        create an account or hold a wallet balance. You are responsible for ensuring that
        participating in skill-based competitions for stakes is lawful where you reside. We reserve
        the right to restrict access from jurisdictions where this is not the case.
      </p>
    ),
  },
  {
    heading: "3. Account Verification",
    body: (
      <p>
        Before your first withdrawal, you must complete identity verification (KYC). This exists to
        ensure winnings are paid to the person who actually earned them and to prevent
        multi-accounting. Providing false identity information, or attempting to verify an account
        that is not your own, is grounds for immediate suspension and forfeiture of any balance
        obtained through the violation.
      </p>
    ),
  },
  {
    heading: "4. Wallet, Stakes & Escrow",
    body: (
      <div className="space-y-3">
        <p>
          Funds you deposit are held in your wallet&apos;s available balance until you use them.
          When you accept a challenge, your stake moves into escrow and is no longer available to
          spend, withdraw, or use elsewhere until the match resolves. Escrowed funds are released to
          the winner once a result is confirmed, or returned to both players if a challenge is
          cancelled before it starts.
        </p>
        <p>
          You may withdraw any funds in your available balance (not currently held in escrow) at any
          time, subject to identity verification and our payment provider&apos;s standard
          processing.
        </p>
      </div>
    ),
  },
  {
    heading: "5. Fair Play & Prohibited Conduct",
    body: (
      <div className="space-y-3">
        <p>You agree not to, and represent that you will not:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Use cheats, exploits, third-party assistance software, or account boosting services in
            any match played for a stake.
          </li>
          <li>Collude with an opponent to manipulate or predetermine a match result.</li>
          <li>
            Create or control more than one account, or attempt to circumvent a suspension by
            creating a new one.
          </li>
          <li>Submit falsified evidence during a dispute review.</li>
          <li>
            Attempt to interfere with, reverse engineer, or abuse the platform&apos;s matchmaking,
            wallet, or ranking systems.
          </li>
        </ul>
        <p>
          Violations may result in match forfeiture, balance forfeiture, and permanent account
          suspension, at our sole discretion and proportionate to the violation.
        </p>
      </div>
    ),
  },
  {
    heading: "6. Disputes",
    body: (
      <p>
        If you believe a match result was recorded incorrectly, you may open a dispute and submit
        supporting evidence within the challenge&apos;s evidence window. A member of our moderation
        team will review the evidence submitted by both participants and issue a ruling. Moderation
        decisions are made in good faith based on the evidence available and are final.
      </p>
    ),
  },
  {
    heading: "7. Fees",
    body: (
      <p>
        We may apply a service fee to match stakes, tournament entries, or withdrawals. Any
        applicable fee is disclosed to you before you confirm the relevant action — you will never
        be charged a fee you weren&apos;t shown in advance.
      </p>
    ),
  },
  {
    heading: "8. Account Suspension & Termination",
    body: (
      <p>
        We may suspend or terminate an account that violates these Terms, is used fraudulently, or
        poses a risk to other players or the platform. Where an investigation is ongoing, funds
        related to the matter under review may be held pending its outcome. You may close your
        account at any time by contacting support once you have no active challenges and no escrowed
        balance.
      </p>
    ),
  },
  {
    heading: "9. Limitation of Liability",
    body: (
      <p>
        The platform is provided &quot;as is.&quot; To the fullest extent permitted by law,
        ChampionsStake is not liable for indirect, incidental, or consequential damages arising from
        your use of the platform, including losses resulting from a game&apos;s own bugs, network
        outages outside our control, or a third-party payment provider&apos;s processing delays.
        Nothing in this section limits liability that cannot be excluded by law.
      </p>
    ),
  },
  {
    heading: "10. Changes to These Terms",
    body: (
      <p>
        We may update these Terms from time to time. Material changes will be communicated in
        advance where reasonably possible. Continuing to use the platform after a change takes
        effect constitutes acceptance of the updated Terms.
      </p>
    ),
  },
  {
    heading: "11. Contact",
    body: (
      <p>
        Questions about these Terms can be sent through the support contact listed in your account
        settings once signed in.
      </p>
    ),
  },
];

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-vv-text-tertiary">Last updated: 2026</p>

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
