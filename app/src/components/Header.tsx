// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet, type WalletPersona } from '@/context/WalletContext';
import { useOraclePrice } from '@/hooks/useOraclePrice';
import { InvariantsModal } from '@/components/InvariantsModal';
import { ElpiLogo } from '@/components/ElpiLogo';

export const Header: React.FC = () => {
  const {
    address,
    persona,
    isConnected,
    isConnecting,
    balances,
    connect,
    disconnect,
  } = useWallet();

  const { spotPrice, isStale, isWarning, refresh: refreshOracle } = useOraclePrice();

  const pathname = usePathname();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [showInvariants, setShowInvariants] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Close menus on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
    setShowDropdown(false);
  }, [pathname]);

  // Close mobile drawer on desktop resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSelectPersona = async (mode: WalletPersona) => {
    setShowModal(false);
    await connect(mode);
  };

  const navItems = [
    { href: '/', label: 'Trade & Terminal' },
    { href: '/onboard', label: 'Asset Onboard (CCA)', badge: 'v4 CCA' },
    { href: '/lp/vault', label: 'LP Vaults' },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[#2D2F3F]/60 bg-[#0D0E15]/80 backdrop-blur-xl transition-all">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          {/* Logo & Navigation */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 group">
              <ElpiLogo size="md" showDomain={true} showBadge={true} badgeText="Uniswap v4" />
            </Link>

            <nav className="hidden md:flex items-center gap-1.5 text-sm font-medium">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-2 ${
                      isActive
                        ? 'bg-white/10 text-white shadow-sm font-semibold border border-[#2D2F3F]'
                        : 'text-uni-muted hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {item.label}
                    {item.badge && (
                      <span className="text-[10px] bg-uni-blue-subtle text-uni-blue px-1.5 py-0.2 rounded-full border border-uni-blue/30 font-mono">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}

              <button
                onClick={() => setShowInvariants(true)}
                className="px-3 py-1.5 rounded-full text-xs font-mono text-uni-muted hover:text-uni-pink hover:bg-uni-pink-subtle border border-transparent hover:border-uni-pink/20 transition-all flex items-center gap-1.5"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-uni-pink animate-pulse" />
                Invariants (I1-I4)
              </button>
            </nav>
          </div>

          {/* Right Section: Chain & Oracle Badges + Wallet Connector */}
          <div className="flex items-center gap-3">
            {/* Live Chainlink Oracle Spot Price Pill (from Stitch TopNavBar) */}
            <div
              onClick={refreshOracle}
              title="Click to refresh Oracle Spot Price"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#13141E]/90 border border-[#2D2F3F] text-xs font-mono cursor-pointer hover:border-[#4C82FB]/40 transition-colors shadow-inner"
            >
              <span className={`w-2 h-2 rounded-full ${isStale ? 'bg-uni-red' : isWarning ? 'bg-uni-amber' : 'bg-stitch-tertiary status-pulse'}`} />
              <span className="text-zinc-400 text-[11px]">ETH:</span>
              <span className="font-bold text-stitch-tertiary-bright">
                ${spotPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {/* Network indicator with latency & block */}
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#13141E]/90 border border-[#2D2F3F] text-[11px] font-mono text-zinc-400 shadow-inner">
              <span className="h-1.5 w-1.5 rounded-full bg-stitch-tertiary status-pulse" />
              <span>Base: 12ms</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-300">Blk: 19.4M</span>
            </div>

            {/* Connected state */}
            {isConnected && address ? (
              <div className="relative">
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-2.5 rounded-full bg-[#13141E] hover:bg-[#1A1B26] border border-white/10 hover:border-uni-pink/30 px-3.5 py-1.5 text-xs font-mono text-white transition-all shadow-md"
                >
                  {/* Persona Tag */}
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      persona === 'LP'
                        ? 'bg-uni-green-subtle text-uni-green border border-uni-green/30'
                        : persona === 'TAKER'
                        ? 'bg-uni-pink-subtle text-uni-pink border border-uni-pink/30'
                        : persona === 'DEPLOYER'
                        ? 'bg-uni-amber-subtle text-uni-amber border border-uni-amber/30'
                        : 'bg-white/10 text-zinc-300'
                    }`}
                  >
                    {persona === 'LP'
                      ? 'LP Alice'
                      : persona === 'TAKER'
                      ? 'Taker Bob'
                      : persona === 'DEPLOYER'
                      ? 'Admin'
                      : 'Connected'}
                  </span>

                  {/* Balances Pill */}
                  <span className="text-uni-muted hidden lg:inline font-mono">
                    {balances.weth} WETH • ${balances.usdc}
                  </span>

                  {/* Truncated Address */}
                  <span className="font-semibold text-white">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </span>
                  <span className="text-uni-muted text-[10px]">▼</span>
                </button>

                {/* Account Dropdown */}
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-72 rounded-3xl bg-[#13141E] border border-white/10 p-3 shadow-uni-card z-50 text-xs font-sans space-y-2 animate-fade-in backdrop-blur-xl">
                    <div className="p-3 border-b border-white/10">
                      <div className="text-[10px] uppercase text-uni-muted font-bold tracking-wider">
                        Connected Account
                      </div>
                      <div className="font-mono text-white break-all text-[11px] mt-1 font-semibold">
                        {address}
                      </div>
                    </div>

                    <div className="p-3 space-y-1.5 font-mono text-[11px] text-zinc-300 bg-[#0D0E15] rounded-2xl border border-white/5">
                      <div className="flex justify-between">
                        <span className="text-uni-muted">ETH Balance:</span>
                        <span className="text-white font-bold">{balances.eth}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-uni-muted">WETH Balance:</span>
                        <span className="text-white font-bold">{balances.weth}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-uni-muted">USDC Balance:</span>
                        <span className="text-uni-green font-bold">${balances.usdc}</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-white/10 space-y-1">
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          setShowModal(true);
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl text-zinc-200 hover:bg-white/5 hover:text-white transition-colors flex items-center justify-between"
                      >
                        <span>Switch Persona / Wallet</span>
                        <span className="text-uni-pink text-xs">→</span>
                      </button>
                      <button
                        onClick={() => {
                          disconnect();
                          setShowDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl text-uni-red hover:bg-uni-red-subtle transition-colors font-semibold"
                      >
                        Disconnect Wallet
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowModal(true)}
                disabled={isConnecting}
                className="rounded-full bg-gradient-to-r from-uni-pink via-uni-pink-hover to-uni-purple hover:brightness-110 px-4 sm:px-5 py-2 text-xs font-bold text-white transition-all shadow-uni-pink active:scale-95 whitespace-nowrap"
              >
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}

            {/* Mobile Hamburger Toggle (md:hidden) */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden w-8 h-8 rounded-xl bg-[#13141E] border border-white/10 text-white flex items-center justify-center hover:bg-white/5 transition-colors focus:outline-none"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? (
                <span className="text-sm font-bold">✕</span>
              ) : (
                <span className="text-base leading-none">☰</span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-[#0D0E15]/95 backdrop-blur-2xl px-4 py-4 space-y-3 animate-fade-in shadow-uni-card">
            <nav className="flex flex-col gap-1 text-sm font-medium">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`px-4 py-2.5 rounded-2xl transition-all flex items-center justify-between ${
                      isActive
                        ? 'bg-gradient-to-r from-uni-pink-subtle to-uni-purple/20 text-white font-bold border border-uni-pink/30 shadow-[0_0_12px_rgba(255,0,122,0.15)]'
                        : 'text-uni-muted hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.badge && (
                      <span className="text-[10px] bg-uni-blue-subtle text-uni-blue px-2 py-0.5 rounded-full border border-uni-blue/30 font-mono font-bold">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setShowInvariants(true);
                }}
                className="w-full text-left px-4 py-2.5 rounded-2xl text-xs font-mono text-uni-pink hover:bg-uni-pink-subtle border border-uni-pink/20 transition-all flex items-center justify-between mt-1"
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-uni-pink animate-pulse" />
                  Protocol Invariants (I1-I4)
                </span>
                <span className="text-[10px] text-uni-muted">View Proofs →</span>
              </button>
            </nav>

            {/* Mobile Network info pill */}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs font-mono text-uni-muted px-2">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-uni-green animate-pulse" />
                Base Chain (8453)
              </span>
              <span className="text-uni-pink text-[11px] font-semibold">Uniswap v4 Ready</span>
            </div>
          </div>
        )}

        {/* Persona Selection Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="w-full max-w-md rounded-3xl bg-[#13141E] border border-white/10 p-6 space-y-5 shadow-uni-card text-white font-sans">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-uni-pink">🦄</span> Connect to elpi.xyz
                  </h3>
                  <p className="text-xs text-uni-muted mt-0.5">
                    Select a devnet persona for 1-click testing, or use your browser wallet.
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 text-uni-muted hover:text-white flex items-center justify-center transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Devnet Personas */}
              <div className="space-y-2.5">
                <div className="text-[11px] font-bold text-uni-muted uppercase tracking-wider">
                  Devnet Pre-Funded Personas
                </div>

                <button
                  onClick={() => handleSelectPersona('LP')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D0E15] hover:bg-[#1A1B26] border border-white/5 hover:border-uni-green/40 text-left transition-all group"
                >
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-uni-green shadow-[0_0_8px_#00D395]" />
                      Alice (elpi1 / LP Vault)
                    </div>
                    <div className="text-[11px] font-mono text-uni-muted mt-0.5">
                      0xf85B...7855 • 75 WETH (+25 staked), 100k USDC
                    </div>
                  </div>
                  <span className="text-xs text-uni-green opacity-0 group-hover:opacity-100 transition-opacity font-semibold">
                    Connect →
                  </span>
                </button>

                <button
                  onClick={() => handleSelectPersona('TAKER')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D0E15] hover:bg-[#1A1B26] border border-white/5 hover:border-uni-pink/40 text-left transition-all group"
                >
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-uni-pink shadow-[0_0_8px_#FF007A]" />
                      Bob (elpi2 / Taker 1)
                    </div>
                    <div className="text-[11px] font-mono text-uni-muted mt-0.5">
                      0x6175...a813 • 50 WETH, 50k USDC
                    </div>
                  </div>
                  <span className="text-xs text-uni-pink opacity-0 group-hover:opacity-100 transition-opacity font-semibold">
                    Connect →
                  </span>
                </button>

                <button
                  onClick={() => handleSelectPersona('TAKER2')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D0E15] hover:bg-[#1A1B26] border border-white/5 hover:border-uni-blue/40 text-left transition-all group"
                >
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-uni-blue shadow-[0_0_8px_#4C82FB]" />
                      Charlie (elpi3 / Taker 2)
                    </div>
                    <div className="text-[11px] font-mono text-uni-muted mt-0.5">
                      0xEB1b...865b • 50 WETH, 50k USDC
                    </div>
                  </div>
                  <span className="text-xs text-uni-blue opacity-0 group-hover:opacity-100 transition-opacity font-semibold">
                    Connect →
                  </span>
                </button>

                <button
                  onClick={() => handleSelectPersona('DEPLOYER')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D0E15] hover:bg-[#1A1B26] border border-white/5 hover:border-uni-amber/40 text-left transition-all group"
                >
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-uni-amber shadow-[0_0_8px_#F3B71E]" />
                      Deployer / Governance
                    </div>
                    <div className="text-[11px] font-mono text-uni-muted mt-0.5">
                      0xf39F...2266 • 100 WETH, 100k USDC
                    </div>
                  </div>
                  <span className="text-xs text-uni-amber opacity-0 group-hover:opacity-100 transition-opacity font-semibold">
                    Connect →
                  </span>
                </button>
              </div>

              {/* Injected Browser Wallet */}
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="text-[11px] font-bold text-uni-muted uppercase tracking-wider">
                  Browser Extension
                </div>
                <button
                  onClick={() => handleSelectPersona('INJECTED')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D0E15] hover:bg-[#1A1B26] border border-white/5 hover:border-uni-blue/40 text-left transition-all group"
                >
                  <div>
                    <div className="text-xs font-bold text-white">Injected Wallet</div>
                    <div className="text-[11px] text-uni-muted mt-0.5">
                      MetaMask, Rabby, Coinbase Wallet
                    </div>
                  </div>
                  <span className="text-xs text-uni-blue opacity-0 group-hover:opacity-100 transition-opacity font-semibold">
                    Connect →
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Protocol Invariants Modal */}
      <InvariantsModal isOpen={showInvariants} onClose={() => setShowInvariants(false)} />
    </>
  );
};

export default Header;
