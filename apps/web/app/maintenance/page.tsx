import { AuthCard } from "@/components/auth/AuthCard";

export default function MaintenancePage() {
  return (
    <AuthCard title="Down for maintenance" subtitle="We'll be back shortly.">
      <p className="font-exo text-center text-sm text-vv-text-secondary">
        ChampionsStake is temporarily unavailable while we perform scheduled
        maintenance. Your funds and account data are safe — nothing needs to
        be done on your end. Please check back in a few minutes.
      </p>
    </AuthCard>
  );
}
