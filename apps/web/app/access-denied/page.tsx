import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";

export default function AccessDeniedPage() {
  return (
    <AuthCard title="Access denied" subtitle="You don't have permission to view that page.">
      <p className="font-exo text-vv-text-secondary mb-6 text-center text-sm">
        This area is restricted to specific account roles, or your account is not currently active.
        If you believe this is a mistake, contact support.
      </p>
      <Link
        href="/dashboard"
        className="font-exo bg-vv-neon-green text-vv-black block w-full rounded px-4 py-2 text-center font-semibold hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </AuthCard>
  );
}
