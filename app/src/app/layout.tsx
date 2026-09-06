import React from 'react';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Header } from '@/components/Header';

export const metadata = {
  title: 'elpi (elpi.xyz) — Fixed-Agreement Options on Base × Uniswap v4',
  description:
    'Options protocol on Base built on fixed agreements over disclosed risks with per-position custody and Uniswap v4 execution.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans antialiased selection:bg-indigo-500 selection:text-white">
        <Providers>
          {/* Navigation Bar with Live Wallet Connection */}
          <Header />

          {/* Main Content */}
          <main className="flex-1">{children}</main>
        </Providers>

        {/* Protocol Invariant Footer */}
        <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-600 font-mono">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>elpi (elpi.xyz) • Invariant I1 (Bounded Insolvency) • I2 (Immutability) • I3 (Venue-Free Recovery) • I4 (Fee Base Protection)</span>
            <span>Uniswap v4 Flash-Accounting & EIP-1153 Netting</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
