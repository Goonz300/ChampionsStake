import type { Config } from "tailwindcss";

/**
 * Tailwind config for ChampionsStake.
 *
 * Color tokens and font families are copied verbatim from the approved
 * HTML prototype's inline tailwind.config script, per the standing
 * instruction to preserve 100% of the existing visual design when the
 * frontend is ported into Next.js in later Phase 1/2 tasks. Do not rename
 * or remove any token below without an explicit instruction, since
 * component class names in the ported markup will reference these exactly.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "vv-black": "#000000",
        "vv-surface": "#1A1A1A",
        "vv-divider": "#333333",
        "vv-text-secondary": "#CCCCCC",
        "vv-text-tertiary": "#999999",
        "vv-neon-green": "#39FF14",
        "vv-bright-yellow": "#FFD700",
        "vv-loss-red": "#FF4444",
        "vv-success-green": "#00C853",

        // A separate "cs-*" blue palette briefly existed here for the public
        // marketing site (components/marketing/). It was removed after a
        // visual-identity audit confirmed "vv-*" above is the ORIGINAL
        // ChampionsStake brand palette and the marketing site was restyled
        // to use it directly -- confirmed via repo-wide grep that zero
        // components referenced any "cs-*" token before deletion. If a
        // marketing-only accent is ever needed again, extend vv-* rather
        // than reintroducing a second competing color system.
      },
      fontFamily: {
        // Point at the CSS variables next/font/google generates in
        // app/layout.tsx. Falls back to the bare family name (harmless if
        // that font isn't loaded, e.g. in a test/SSR-only render) then a
        // generic. Token names unchanged — only the value now actually
        // resolves to a loaded font instead of silently falling back to the
        // browser default, which is what happened everywhere before this.
        orbitron: ["var(--font-orbitron)", "Orbitron", "sans-serif"],
        exo: ["var(--font-exo)", "Exo 2", "sans-serif"],
        mono: ["var(--font-roboto-mono)", "Roboto Mono", "monospace"],
      },
      keyframes: {
        "landing-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "landing-fade-up": {
          from: { opacity: "0", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "landing-scale-in": {
          from: { opacity: "0", transform: "scale(0.92)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "landing-float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "landing-glow-pulse": {
          "0%, 100%": { opacity: "0.55", filter: "brightness(1)" },
          "50%": { opacity: "1", filter: "brightness(1.35)" },
        },
        "landing-grid-move": {
          from: { backgroundPosition: "0px 0px" },
          to: { backgroundPosition: "48px 48px" },
        },
        "landing-drift-slow": {
          "0%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(2%, -3%) scale(1.05)" },
          "100%": { transform: "translate(0, 0) scale(1)" },
        },
        "landing-drift-slower": {
          "0%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(-3%, 2%) scale(1.08)" },
          "100%": { transform: "translate(0, 0) scale(1)" },
        },
        "landing-shimmer": {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
        "landing-ping-soft": {
          "0%": { transform: "scale(1)", opacity: "0.7" },
          "75%, 100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "landing-count-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },

        // Marketing site keyframes -- restrained on purpose: no scale, no
        // rotation, no color shimmer. Motion here exists only to signal
        // "live system", never to decorate.
        "mkt-pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "mkt-scan": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "mkt-fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "landing-fade-in": "landing-fade-in 0.8s ease-out both",
        "landing-fade-up": "landing-fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both",
        "landing-scale-in": "landing-scale-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
        "landing-float": "landing-float 6s ease-in-out infinite",
        "landing-float-slow": "landing-float 9s ease-in-out infinite",
        "landing-glow-pulse": "landing-glow-pulse 3.2s ease-in-out infinite",
        "landing-grid-move": "landing-grid-move 4s linear infinite",
        "landing-drift-slow": "landing-drift-slow 18s ease-in-out infinite",
        "landing-drift-slower": "landing-drift-slower 24s ease-in-out infinite",
        "landing-shimmer": "landing-shimmer 2.6s linear infinite",
        "landing-ping-soft": "landing-ping-soft 2.4s cubic-bezier(0, 0, 0.2, 1) infinite",
        "landing-count-in": "landing-count-in 0.5s ease-out both",

        "mkt-pulse-dot": "mkt-pulse-dot 2.4s ease-in-out infinite",
        "mkt-scan": "mkt-scan 6s linear infinite",
        "mkt-fade-up": "mkt-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
