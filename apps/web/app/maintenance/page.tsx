import { AuthCard } from "@/components/auth/AuthCard";

export default function MaintenancePage() {
  return (
    <AuthCard title="Down for maintenance" subtitle="We'll be back shortly.">
      <p className="font-exo text-vv-text-secondary text-center text-sm">
        ChampionsStake is temporarily unavailable while we perform scheduled maintenance. Your funds
        and account data are safe — nothing needs to be done on your end. Please check back in a few
        minutes.
      </p>
    </AuthCard>
  );
}
