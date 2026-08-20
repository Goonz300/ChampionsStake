import { ScrollReveal } from "@/components/marketing/ScrollReveal";

export function ContactSection() {
  return (
    <section className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <div className="mkt-border bg-vv-surface flex flex-col items-start justify-between gap-8 rounded-xl px-8 py-10 sm:flex-row sm:items-center sm:px-12">
            <div>
              <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">Contact</p>
              <h2 className="font-exo mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Get in touch.
              </h2>
              <p className="text-vv-text-secondary mt-3 max-w-sm text-sm leading-relaxed">
                Questions about the platform, a challenge, or your account — reach us directly.
              </p>
            </div>
            <a
              href="mailto:support@championsstake.app"
              className="mkt-focus-ring bg-vv-neon-green text-vv-black shrink-0 rounded-md px-6 py-3 text-sm font-bold transition-opacity hover:opacity-90"
            >
              support@championsstake.app
            </a>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
