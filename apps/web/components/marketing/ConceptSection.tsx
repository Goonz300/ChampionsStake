import { ScrollReveal } from "@/components/marketing/ScrollReveal";

const INFO_COLUMN: Array<{ label: string; value: string }> = [
  { label: "Format", value: "Head-to-head & bracketed" },
  { label: "Basis", value: "Measured performance" },
  { label: "Resolution", value: "Defined rule set" },
  { label: "Visibility", value: "Status tracked throughout" },
];

/**
 * Editorial layout, deliberately not a card grid: one large statement, one
 * supporting paragraph, one small technical info column -- per the brief's
 * explicit instruction against a three-card feature section here.
 */
export function ConceptSection() {
  return (
    <section id="platform" className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">The Concept</p>
        </ScrollReveal>

        <div className="mt-6 grid gap-14 lg:grid-cols-[1.4fr_1fr]">
          <ScrollReveal>
            <h2 className="font-exo max-w-xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Competition,
              <br />
              structured.
            </h2>
            <p className="text-vv-text-secondary mt-6 max-w-lg text-[15px] leading-relaxed">
              ChampionsStake organizes competition into defined challenge formats — each with clear
              entry conditions, a fixed rule set, and a tracked status from start to result. The
              structure is the product: participants always know what they entered, how it resolves,
              and where it stands.
            </p>
          </ScrollReveal>

          <ScrollReveal delayMs={100}>
            <dl className="border-vv-divider grid grid-cols-2 gap-x-6 gap-y-6 border-l pl-8 lg:grid-cols-1">
              {INFO_COLUMN.map((item) => (
                <div key={item.label}>
                  <dt className="font-mono text-vv-text-tertiary text-[10px] uppercase tracking-widest">
                    {item.label}
                  </dt>
                  <dd className="font-exo mt-1.5 text-sm font-medium text-white">{item.value}</dd>
                </div>
              ))}
            </dl>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
