import React from 'react';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Header } from '@/components/Header';
import { ElpiLogo } from '@/components/ElpiLogo';
import { BackgroundShader } from '@/components/BackgroundShader';

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
      <body className="min-h-screen bg-[#0D0E15] text-white flex flex-col font-sans antialiased selection:bg-uni-pink selection:text-white relative">
        {/* Deep Space WebGL Ambient Shader */}
        <BackgroundShader />

        <Providers>
          {/* Navigation Bar with Live Wallet Connection */}
          <Header />

          {/* Main Content */}
          <main className="flex-1 relative z-10">{children}</main>
        </Providers>

        {/* Protocol Invariant Footer */}
        <footer className="border-t border-white/[0.08] bg-[#0D0E15]/90 py-6 text-center text-xs text-uni-muted font-mono relative z-10 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <ElpiLogo size="sm" showBadge={false} />
              <span>•</span>
              <span className="text-uni-pink font-semibold">I1</span>
              <span>(Bounded Insolvency)</span>
              <span>•</span>
              <span className="text-uni-blue font-semibold">I2</span>
              <span>(Immutability)</span>
              <span>•</span>
              <span className="text-uni-green font-semibold">I3</span>
              <span>(Venue-Free)</span>
              <span>•</span>
              <span className="text-uni-amber font-semibold">I4</span>
              <span>(Fee Base Protection)</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-uni-tertiary">
              <span className="inline-block w-2 h-2 rounded-full bg-uni-pink animate-pulse" />
              <span>Uniswap v4 Flash-Accounting & EIP-1153 Transient Netting</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
