import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";

export const metadata: Metadata = {
  title: "ChampionsStake",
  description: "Competitive gaming marketplace with escrow-protected challenges.",
  metadataBase: new URL("https://championsstake.app"),
  openGraph: {
    title: "ChampionsStake",
    description: "Competitive gaming marketplace with escrow-protected challenges.",
    url: "https://championsstake.app",
    siteName: "ChampionsStake",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "ChampionsStake",
    description: "Competitive gaming marketplace with escrow-protected challenges.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-vv-black text-white antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
