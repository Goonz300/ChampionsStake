import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — ChampionsStake",
  description: "How ChampionsStake collects, uses, and protects your data.",
};

const SECTIONS: Array<{ heading: string; body: React.ReactNode }> = [
  {
    heading: "1. Information We Collect",
    body: (
      <div className="space-y-3">
        <p>We collect information in three ways:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <span className="font-semibold text-white">You provide directly</span> — account details
            (email, display name), identity verification documents when you complete KYC, and
            anything you submit as evidence during a dispute.
          </li>
          <li>
            <span className="font-semibold text-white">Collected automatically</span> — device and
            connection information (IP address, browser type, approximate location derived from IP),
            and activity logs (logins, matches played, wallet transactions) used for security and
            fraud prevention.
          </li>
          <li>
            <span className="font-semibold text-white">From third parties</span> — confirmation of
            payment status from our payment processor, and identity verification results from our
            KYC provider. We never receive your full card or bank details directly; those are
            handled entirely by our payment processor.
          </li>
        </ul>
      </div>
    ),
  },
  {
    heading: "2. How We Use Your Information",
    body: (
      <ul className="list-disc space-y-1 pl-6">
        <li>Operate your account, wallet, and match history.</li>
        <li>Verify your identity before releasing withdrawals.</li>
        <li>
          Detect and prevent fraud, multi-accounting, and cheating, including automated risk
          analysis of account and match activity.
        </li>
        <li>Investigate and resolve disputes between players.</li>
        <li>
          Send account, security, and transaction notifications (e.g. login alerts, withdrawal
          confirmations).
        </li>
        <li>
          Maintain the security of the platform, including rate-limiting and blocking abusive
          traffic.
        </li>
        <li>
          Comply with legal obligations, including anti-fraud and financial recordkeeping
          requirements.
        </li>
      </ul>
    ),
  },
  {
    heading: "3. Cookies & Session Data",
    body: (
      <p>
        We use a small number of strictly necessary cookies to keep you signed in and to protect
        your session (for example, recognizing your browser across requests so we can enforce
        multi-factor authentication and detect suspicious login patterns). These cookies are
        essential to the service and are not used for third-party advertising or cross-site
        tracking.
      </p>
    ),
  },
  {
    heading: "4. Who We Share Data With",
    body: (
      <div className="space-y-3">
        <p>We share the minimum data necessary with a small number of service providers:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Our database and authentication infrastructure provider, which stores your account and
            match data.
          </li>
          <li>Our payment processor, to move funds in and out of your wallet.</li>
          <li>Our email provider, to deliver account and security notifications.</li>
          <li>
            Our identity verification provider, solely to confirm your identity for KYC purposes.
          </li>
        </ul>
        <p>
          We do not sell your personal information. We disclose information beyond these providers
          only when required by law, to enforce these Terms, or to protect the rights, property, or
          safety of ChampionsStake, our players, or the public.
        </p>
      </div>
    ),
  },
  {
    heading: "5. Data Retention",
    body: (
      <p>
        We retain account and transaction data for as long as your account is active, and for a
        reasonable period afterward as required to meet financial recordkeeping and fraud prevention
        obligations. Identity verification documents are retained only as long as necessary to
        satisfy those same obligations, then deleted or anonymized.
      </p>
    ),
  },
  {
    heading: "6. Your Rights",
    body: (
      <p>
        Depending on where you live, you may have the right to request access to, correction of, or
        deletion of your personal data, and to object to certain processing. You can review and
        update most account information directly in Settings once signed in; for anything else,
        contact us through the support option in your account. Note that we may need to retain
        certain records (e.g. transaction history) even after a deletion request, where required by
        law.
      </p>
    ),
  },
  {
    heading: "7. Security",
    body: (
      <p>
        Account data is protected with encrypted connections, hardened authentication (including
        optional multi-factor authentication), and rate-limited login and password-reset flows.
        Wallet balances are enforced by database-level constraints in addition to application
        checks, so they can&apos;t be modified through any path other than a verified transaction.
      </p>
    ),
  },
  {
    heading: "8. Children's Privacy",
    body: (
      <p>
        ChampionsStake is not directed at, and is not intended for use by, anyone under 18. We do
        not knowingly collect personal information from anyone under 18. If we learn an account
        belongs to someone under 18, we will suspend it and delete the associated data.
      </p>
    ),
  },
  {
    heading: "9. Changes to This Policy",
    body: (
      <p>
        We may update this Privacy Policy from time to time. Material changes will be communicated
        in advance where reasonably possible. Continuing to use the platform after a change takes
        effect constitutes acceptance of the updated policy.
      </p>
    ),
  },
  {
    heading: "10. Contact",
    body: (
      <p>
        Questions about this Privacy Policy, or requests relating to your personal data, can be sent
        through the support contact listed in your account settings once signed in.
      </p>
    ),
  },
];

export default function PrivacyPage() {
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
          Privacy Policy
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
