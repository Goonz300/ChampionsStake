import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Generated favicon -- no dependency added (next/og ships with Next.js).
 * Mirrors components/marketing/Logo.tsx's mark: a pure-black square with
 * the original ChampionsStake neon-green (vv-neon-green #39FF14) accent
 * dot, nothing more.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
          borderRadius: 7,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#39FF14",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
