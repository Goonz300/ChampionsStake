import { ScrollReveal } from "@/components/marketing/ScrollReveal";

const CHALLENGES: Array<{ title: string; format: string; status: "OPEN" | "IN PROGRESS" | "RESOLVED" }> = [
  { title: "Weekly Format Challenge", format: "Bracketed · 8 entrants", status: "OPEN" },
  { title: "Head-to-Head Series", format: "1v1 · Best of 3", status: "IN PROGRESS" },
  { title: "Monthly Performance Round", format: "Leaderboard · 30 days", status: "OPEN" },
  { title: "Qualifier Match", format: "1v1 · Single elimination", status: "RESOLVED" },
];

// Same three-tone convention used throughout the marketing site (and the
// real app's own status-labels.ts): open/actionable = neon green,
// in-progress/warning = bright yellow, resolved/neutral = muted gray.
const STATUS_STYLES: Record<string, string> = {
  OPEN: "border-vv-neon-green/40 text-vv-neon-green",
  "IN PROGRESS": "border-vv-bright-yellow/40 text-vv-bright-yellow",
  RESOLVED: "border-vv-divider text-vv-text-tertiary",
};

const TREND_BARS = [30, 45, 38, 58, 50, 66, 72];

const STANDINGS = ["Participant A", "Participant B", "Participant C", "Participant D"];

/**
 * Three panels that read as one coherent product, not five unrelated
 * mockups: a central "challenge discovery" list, with a performance trend
 * panel and a standings panel beside it -- all sharing the same chrome,
 * borders, and mono label convention as ArenaVisual.tsx. Placeholder
 * content only (no real challenge data, no invented statistics -- the
 * trend chart intentionally carries no numeric labels).
 *
 * Standings bars are bright yellow rather than neon green on purpose --
 * per the brand direction, yellow is reserved for rankings/competitive
 * elements specifically, keeping green meaningful as the one CTA/active-
 * state color instead of using it for every accent on the page.
 */
export function PlatformExperienceSection() {
  return (
    <section className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">
            Platform Experience
          </p>
          <h2 className="font-exo mt-4 max-w-lg text-4xl font-bold tracking-tight text-white sm:text-5xl">
            One system, every view.
          </h2>
        </ScrollReveal>

        <div className="mt-14 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <ScrollReveal className="lg:row-span-2">
            <div className="mkt-border bg-vv-surface h-full rounded-xl">
              <div className="border-vv-divider flex items-center justify-between border-b px-5 py-4">
                <span className="font-mono text-vv-text-tertiary text-[10px] uppercase tracking-widest">
                  challenge_discovery.sys
                </span>
                <div className="flex gap-2">
                  {["ALL", "OPEN"].map((chip) => (
                    <span
                      key={chip}
                      className="border-vv-divider text-vv-text-tertiary rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-widest"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
              <ul className="divide-vv-divider divide-y">
                {CHALLENGES.map((c) => (
                  <li key={c.title} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="font-exo text-sm font-semibold text-white">{c.title}</p>
                      <p className="font-mono text-vv-text-tertiary mt-1 text-[10px] uppercase tracking-wide">
                        {c.format}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest ${STATUS_STYLES[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={80}>
            <div className="mkt-border bg-vv-surface rounded-xl p-5">
              <span className="font-mono text-vv-text-tertiary text-[10px] uppercase tracking-widest">
                performance_trend.sys
              </span>
              <div className="mt-6 flex h-24 items-end gap-2">
                {TREND_BARS.map((height, i) => (
                  <div
                    key={i}
                    style={{ height: `${height}%` }}
                    className="bg-vv-neon-green/60 first:bg-vv-divider w-full rounded-t-sm"
                  />
                ))}
              </div>
              <p className="text-vv-text-tertiary mt-4 text-xs">Illustrative view — not live data.</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={140}>
            <div className="mkt-border bg-vv-surface rounded-xl p-5">
              <span className="font-mono text-vv-text-tertiary text-[10px] uppercase tracking-widest">
                standings.sys
              </span>
              <ul className="mt-5 space-y-3">
                {STANDINGS.map((name, i) => (
                  <li key={name} className="flex items-center gap-3">
                    <span className="font-mono text-vv-text-tertiary w-5 text-[11px]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-exo text-vv-text-secondary flex-1 text-sm">{name}</span>
                    <div className="bg-vv-divider h-1 w-16 overflow-hidden rounded-full">
                      <div
                        className="bg-vv-bright-yellow h-full rounded-full"
                        style={{ width: `${88 - i * 18}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
