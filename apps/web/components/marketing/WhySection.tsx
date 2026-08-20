import { ScrollReveal } from "@/components/marketing/ScrollReveal";

const PRINCIPLES: Array<{ index: string; title: string; body: string }> = [
  {
    index: "01",
    title: "Structured Competition",
    body: "Every challenge has a defined format and rule set before it begins.",
  },
  {
    index: "02",
    title: "Performance",
    body: "Competition is centered on measurable outcomes, not chance.",
  },
  {
    index: "03",
    title: "Transparency",
    body: "The status and rules of a challenge are visible throughout, not just at the start.",
  },
  {
    index: "04",
    title: "Designed For Competitors",
    body: "The interface prioritizes clarity and focus over decoration.",
  },
];

export function WhySection() {
  return (
    <section className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">
            Why ChampionsStake
          </p>
        </ScrollReveal>

        <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2">
          {PRINCIPLES.map((p, i) => (
            <ScrollReveal key={p.index} delayMs={i * 70}>
              <div className="border-vv-divider border-t pt-6">
                <span className="font-mono text-vv-text-tertiary text-xs">{p.index}</span>
                <h3 className="font-exo mt-3 text-xl font-semibold text-white">{p.title}</h3>
                <p className="text-vv-text-secondary mt-2 max-w-sm text-[15px] leading-relaxed">
                  {p.body}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
