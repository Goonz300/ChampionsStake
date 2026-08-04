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
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
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
      },
      fontFamily: {
        orbitron: ["Orbitron", "sans-serif"],
        exo: ["Exo 2", "sans-serif"],
        mono: ["Roboto Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
