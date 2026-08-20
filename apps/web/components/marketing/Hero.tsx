import Link from "next/link";
import { ArenaVisual } from "@/components/marketing/ArenaVisual";

const MICRO_LABELS = ["Challenge Engine", "Performance Tracking", "Secure Infrastructure"];

export function Hero() {
  return (
    <section className="mkt-section relative overflow-hidden px-5 pb-20 pt-36 sm:px-8 sm:pb-28 sm:pt-44">
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        <div>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">
            Platform · Competition Engine
          </p>

          {/* One deliberate accent word ("ACHIEVE.") rather than the whole
              headline in neon -- keeps the brand color meaningful instead of
              flooding the largest element on the page. */}
          <h1 className="font-exo mt-5 text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
            COMPETE.
            <br />
            PERFORM.
            <br />
            <span className="text-vv-neon-green">ACHIEVE.</span>
          </h1>

          <p className="text-vv-text-secondary mt-6 max-w-md text-[15px] leading-relaxed">
            ChampionsStake is a platform for structured challenges — defined formats, tracked
            performance, and a clear path from entry to result.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/register"
              className="mkt-focus-ring bg-vv-neon-green text-vv-black rounded-md px-6 py-3 text-sm font-bold transition-opacity hover:opacity-90"
            >
              Explore Platform
            </Link>
            <a
              href="#how-it-works"
              className="mkt-focus-ring mkt-border rounded-md px-6 py-3 text-sm font-semibold text-white"
            >
              How It Works
            </a>
          </div>

          <dl className="border-vv-divider mt-14 flex flex-wrap gap-x-8 gap-y-3 border-t pt-6">
            {MICRO_LABELS.map((label) => (
              <div key={label} className="flex items-center gap-2">
                <span aria-hidden="true" className="bg-vv-text-tertiary h-1 w-1 rounded-full" />
                <dt className="font-mono text-vv-text-tertiary text-[10px] uppercase tracking-widest">
                  {label}
                </dt>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative">
          <ArenaVisual />
        </div>
      </div>
    </section>
  );
}
