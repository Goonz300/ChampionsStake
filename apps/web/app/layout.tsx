import type { Metadata } from "next";
import { Orbitron, Exo_2, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";

// tailwind.config.ts's fontFamily tokens (font-orbitron/font-exo/font-mono)
// have referenced these families since the very first phase, but nothing
// ever actually loaded them -- every page has silently been falling back to
// the browser's default sans-serif/monospace this whole time. Loading them
// here, once, at the root layout fixes that everywhere, not just on the
// landing page. next/font self-hosts at build time (no runtime request to
// Google, no layout-shift flash of unstyled text).
const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-orbitron",
  display: "swap",
});

const exo2 = Exo_2({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-exo",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-roboto-mono",
  display: "swap",
});

const SITE_TITLE = "ChampionsStake — Competition & Challenge Platform";
const SITE_DESCRIPTION =
  "ChampionsStake is a digital platform for structured competitions, challenges and performance-driven participation.";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: new URL("https://championsstake.app"),
  alternates: {
    canonical: "https://championsstake.app",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "https://championsstake.app",
    siteName: "ChampionsStake",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${orbitron.variable} ${exo2.variable} ${robotoMono.variable}`}>
      <body className="bg-vv-black font-exo min-h-screen text-white antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
