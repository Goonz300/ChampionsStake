import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";

export default function SessionExpiredPage() {
  return (
    <AuthCard title="Link expired" subtitle="That link is no longer valid.">
      <p className="font-exo text-vv-text-secondary mb-6 text-center text-sm">
        Email verification and password reset links expire after 24 hours (Business Rules §16).
        Request a new one below.
      </p>
      <div className="flex flex-col gap-3">
        <Link
          href="/forgot-password"
          className="font-exo bg-vv-neon-green text-vv-black w-full rounded px-4 py-2 text-center font-semibold hover:opacity-90"
        >
          Request a new password reset link
        </Link>
        <Link
          href="/verify-email"
          className="font-exo border-vv-divider hover:border-vv-neon-green w-full rounded border px-4 py-2 text-center text-white"
        >
          Resend verification email
        </Link>
        <Link
          href="/login"
          className="font-exo text-vv-text-secondary hover:text-vv-neon-green mt-2 text-center text-sm"
        >
          Back to login
        </Link>
      </div>
    </AuthCard>
  );
}
