import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";

export default function SessionExpiredPage() {
  return (
    <AuthCard title="Link expired" subtitle="That link is no longer valid.">
      <p className="font-exo mb-6 text-center text-sm text-vv-text-secondary">
        Email verification and password reset links expire after 24 hours
        (Business Rules §16). Request a new one below.
      </p>
      <div className="flex flex-col gap-3">
        <Link
          href="/forgot-password"
          className="font-exo w-full rounded bg-vv-neon-green px-4 py-2 text-center font-semibold text-vv-black hover:opacity-90"
        >
          Request a new password reset link
        </Link>
        <Link
          href="/verify-email"
          className="font-exo w-full rounded border border-vv-divider px-4 py-2 text-center text-white hover:border-vv-neon-green"
        >
          Resend verification email
        </Link>
        <Link
          href="/login"
          className="font-exo mt-2 text-center text-sm text-vv-text-secondary hover:text-vv-neon-green"
        >
          Back to login
        </Link>
      </div>
    </AuthCard>
  );
}
