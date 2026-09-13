import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/AppShell";
import { PartnerSandbox } from "@/components/PartnerSandbox";

const coinbaseSans = Inter({
  variable: "--font-coinbase-sans",
  subsets: ["latin"],
  display: "swap",
});

const coinbaseMono = JetBrains_Mono({
  variable: "--font-coinbase-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "elpi.xyz — Uniswap v4 Backed Decentralized Options",
  description: "Peer-to-peer options with continuous Uniswap v4 liquidity backing and flash accounting settlement on Base",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "elpi.xyz",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${coinbaseSans.variable} ${coinbaseMono.variable} h-full antialiased`}
      data-theme="dark"
    >
      <body className="flex min-h-full flex-col bg-[var(--background)] text-[var(--foreground)]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-[var(--base-blue)] focus:px-4 focus:py-2 focus:text-white focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Skip to main content
        </a>
        <Providers>
          <AppShell>{children}</AppShell>
          <PartnerSandbox />
        </Providers>
      </body>
    </html>
  );
}
