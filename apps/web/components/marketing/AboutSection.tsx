import { ScrollReveal } from "@/components/marketing/ScrollReveal";

export function AboutSection() {
  return (
    <section id="about" className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-3xl">
        <ScrollReveal>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">About</p>
          <h2 className="font-exo mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            A platform built around competition.
          </h2>
          <p className="text-vv-text-secondary mt-6 text-[15px] leading-relaxed">
            ChampionsStake exists to give structure to competition: clear challenge formats, tracked
            performance, and a defined path from entry to result. The platform is under active
            development — the Platform Status section above reflects what&apos;s available today.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
