import { ScrollReveal } from "@/components/marketing/ScrollReveal";

const STEPS: Array<{ index: string; title: string; body: string }> = [
  { index: "01", title: "Discover", body: "Browse challenge formats and open competitions." },
  { index: "02", title: "Choose", body: "Select a format that matches how you want to compete." },
  { index: "03", title: "Compete", body: "Enter the challenge and play under its defined rules." },
  { index: "04", title: "Track", body: "Follow status and progress as the challenge resolves." },
  { index: "05", title: "Achieve", body: "Results are recorded against your performance history." },
];

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">How It Works</p>
          <h2 className="font-exo mt-4 max-w-lg text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Five steps. One flow.
          </h2>
        </ScrollReveal>

        {/* Desktop: horizontal sequence with a connecting rule. */}
        <div className="relative mt-16 hidden lg:grid lg:grid-cols-5 lg:gap-6">
          <div aria-hidden="true" className="bg-vv-divider absolute left-0 right-0 top-[13px] h-px" />
          {STEPS.map((step, i) => (
            <ScrollReveal key={step.index} delayMs={i * 80}>
              <div className="relative pr-4">
                <div className="border-vv-divider bg-vv-black relative z-10 flex h-7 w-7 items-center justify-center rounded-full border">
                  <span className="font-mono text-vv-neon-green text-[10px]">{step.index}</span>
                </div>
                <h3 className="font-exo mt-5 text-lg font-semibold text-white">{step.title}</h3>
                <p className="text-vv-text-secondary mt-2 text-sm leading-relaxed">{step.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>

        {/* Mobile / tablet: vertical sequence. */}
        <div className="mt-14 space-y-8 lg:hidden">
          {STEPS.map((step, i) => (
            <ScrollReveal key={step.index} delayMs={i * 60}>
              <div className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="border-vv-divider bg-vv-black flex h-7 w-7 shrink-0 items-center justify-center rounded-full border">
                    <span className="font-mono text-vv-neon-green text-[10px]">{step.index}</span>
                  </div>
                  {i < STEPS.length - 1 && <div className="bg-vv-divider mt-2 w-px flex-1" />}
                </div>
                <div className="pb-2">
                  <h3 className="font-exo text-lg font-semibold text-white">{step.title}</h3>
                  <p className="text-vv-text-secondary mt-2 text-sm leading-relaxed">{step.body}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
