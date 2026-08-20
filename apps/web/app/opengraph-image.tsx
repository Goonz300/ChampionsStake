import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Generated Open Graph image -- no dependency added (next/og ships with
 * Next.js), no stock photography. Mirrors the marketing site's own visual
 * language: pure black background, the wordmark in the original
 * ChampionsStake neon green (vv-neon-green #39FF14), and the same short
 * positioning line used in the hero.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#000000",
          padding: 96,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#39FF14" }} />
          <div style={{ fontSize: 30, color: "#FFFFFF", fontWeight: 700, letterSpacing: -0.5 }}>
            ChampionsStake
          </div>
        </div>
        <div
          style={{
            marginTop: 48,
            display: "flex",
            flexDirection: "column",
            fontSize: 72,
            fontWeight: 800,
            color: "#FFFFFF",
            lineHeight: 1.05,
            letterSpacing: -1.5,
          }}
        >
          <span>Competition,</span>
          <span style={{ color: "#39FF14" }}>structured.</span>
        </div>
        <div style={{ marginTop: 36, fontSize: 24, color: "#CCCCCC", maxWidth: 760 }}>
          A digital platform for structured competitions, challenges and performance-driven
          participation.
        </div>
      </div>
    ),
    { ...size },
  );
}
