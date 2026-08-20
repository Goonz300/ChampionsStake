import { ScrollReveal } from "@/components/marketing/ScrollReveal";

type Status = "AVAILABLE" | "IN DEVELOPMENT" | "COMING SOON";

const STATUS_ITEMS: Array<{ label: string; status: Status }> = [
  { label: "Account & Profile", status: "AVAILABLE" },
  { label: "Challenge Formats", status: "IN DEVELOPMENT" },
  { label: "Performance Tracking", status: "IN DEVELOPMENT" },
  { label: "Leaderboards", status: "IN DEVELOPMENT" },
  { label: "Team Competitions", status: "COMING SOON" },
  { label: "Tournament Series", status: "COMING SOON" },
];

// Same semantic tones as lib/vault/status-labels.ts's STATUS_TONE_CLASSES:
// positive = vv-success-green, warning = vv-bright-yellow, neutral = gray.
const STATUS_DOT: Record<Status, string> = {
  AVAILABLE: "bg-vv-success-green",
  "IN DEVELOPMENT": "bg-vv-bright-yellow",
  "COMING SOON": "bg-vv-text-tertiary",
};

const STATUS_TEXT: Record<Status, string> = {
  AVAILABLE: "text-vv-success-green",
  "IN DEVELOPMENT": "text-vv-bright-yellow",
  "COMING SOON": "text-vv-text-tertiary",
};

/**
 * NOTE for whoever ships this: the AVAILABLE / IN DEVELOPMENT / COMING SOON
 * labels below are a conservative placeholder set, not a confirmed release
 * roster -- confirm each one against actual production status before
 * launch. See the build report for why this was left explicit rather than
 * guessed with false confidence.
 */
export function PlatformStatusSection() {
  return (
    <section className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">
            Platform Status
          </p>
          <h2 className="font-exo mt-4 max-w-lg text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Built in the open,
            <br />
            shipped deliberately.
          </h2>
          <p className="text-vv-text-secondary mt-5 max-w-md text-sm leading-relaxed">
            ChampionsStake is under active development. This reflects the current state of the
            platform, not a promise of what&apos;s coming next.
          </p>
        </ScrollReveal>

        <ScrollReveal delayMs={100}>
          <div className="mkt-border divide-vv-divider mt-12 divide-y overflow-hidden rounded-xl">
            {STATUS_ITEMS.map((item) => (
              <div
                key={item.label}
                className="bg-vv-surface flex items-center justify-between px-5 py-4 sm:px-6"
              >
                <span className="font-exo text-sm font-medium text-white">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[item.status]}`} />
                  <span
                    className={`font-mono text-[10px] uppercase tracking-widest ${STATUS_TEXT[item.status]}`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
