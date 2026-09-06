// SPDX-License-Identifier: MIT
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useWallet, type WalletPersona } from '@/context/WalletContext';

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

  const [showModal, setShowModal] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const handleSelectPersona = async (mode: WalletPersona) => {
    setShowModal(false);
    await connect(mode);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
        {/* Logo & Navigation */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-xl font-black tracking-tight text-white group-hover:text-indigo-400 transition-colors">
              elpi<span className="text-indigo-400">.xyz</span>
            </span>
            <span className="text-[10px] uppercase font-mono tracking-widest bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-700">
              v4
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors"
            >
              Trade & Mint
            </Link>
            <Link
              href="/onboard"
              className="px-3 py-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors flex items-center gap-1.5"
            >
              Asset Onboard (CCA)
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
            </Link>
            <Link
              href="/lp/vault"
              className="px-3 py-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors"
            >
              LP Vaults
            </Link>
          </nav>
        </div>

        {/* Right Section: Chain Badge & Wallet Connector */}
        <div className="flex items-center gap-3">
          {/* Network indicator */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {process.env.NEXT_PUBLIC_BASE_RPC_URL?.includes('127.0.0.1')
              ? 'Anvil Devnet (8453)'
              : 'Base Mainnet (8453)'}
          </div>

          {/* Connected state */}
          {isConnected && address ? (
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 px-3 py-1.5 text-xs font-mono text-white transition-colors"
              >
                {/* Persona Tag */}
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    persona === 'LP'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : persona === 'TAKER'
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                      : persona === 'DEPLOYER'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {persona === 'LP'
                    ? 'LP'
                    : persona === 'TAKER'
                    ? 'Taker'
                    : persona === 'DEPLOYER'
                    ? 'Admin'
                    : 'Wallet'}
                </span>

                {/* Balances Pill */}
                <span className="text-zinc-400 hidden lg:inline">
                  {balances.weth} WETH • ${balances.usdc}
                </span>

                {/* Truncated Address */}
                <span className="font-semibold">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </span>
                <span className="text-zinc-500 text-[10px]">▼</span>
              </button>

              {/* Account Dropdown */}
              {showDropdown && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl bg-zinc-900 border border-zinc-800 p-2 shadow-2xl z-50 text-xs font-sans space-y-2">
                  <div className="p-2 border-b border-zinc-800/80">
                    <div className="text-[10px] uppercase text-zinc-500 font-semibold">
                      Connected Account
                    </div>
                    <div className="font-mono text-zinc-200 break-all text-[11px] mt-0.5">
                      {address}
                    </div>
                  </div>

                  <div className="p-2 space-y-1 font-mono text-[11px] text-zinc-300 bg-zinc-950/60 rounded-lg">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">ETH:</span>
                      <span>{balances.eth}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">WETH:</span>
                      <span>{balances.weth}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">USDC:</span>
                      <span>${balances.usdc}</span>
                    </div>
                  </div>

                  <div className="pt-1 border-t border-zinc-800/80 space-y-1">
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        setShowModal(true);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      Switch Persona / Wallet
                    </button>
                    <button
                      onClick={() => {
                        disconnect();
                        setShowDropdown(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowModal(true)}
              disabled={isConnecting}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 text-xs font-medium text-white transition-colors shadow"
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>

      {/* Persona Selection Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 space-y-5 shadow-2xl text-zinc-100 font-sans">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Connect to elpi.xyz</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Select a devnet persona for 1-click testing, or use your browser wallet.
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-zinc-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Devnet Personas */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Devnet Pre-Funded Personas
              </div>

              <button
                onClick={() => handleSelectPersona('LP')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left transition-all group"
              >
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    Alice (LP / Vault Maker)
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                    0x7099...79C8 • 100 WETH, 100k USDC
                  </div>
                </div>
                <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Connect →
                </span>
              </button>

              <button
                onClick={() => handleSelectPersona('TAKER')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left transition-all group"
              >
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    Bob (Taker / Trader)
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                    0x3C44...93BC • 50 WETH, 50k USDC
                  </div>
                </div>
                <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Connect →
                </span>
              </button>

              <button
                onClick={() => handleSelectPersona('DEPLOYER')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left transition-all group"
              >
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    Deployer / Governance
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                    0xf39F...2266 • 100 WETH, 100k USDC
                  </div>
                </div>
                <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Connect →
                </span>
              </button>
            </div>

            {/* Injected Browser Wallet */}
            <div className="pt-2 border-t border-zinc-800 space-y-2">
              <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Browser Extension
              </div>
              <button
                onClick={() => handleSelectPersona('INJECTED')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left transition-all group"
              >
                <div>
                  <div className="text-xs font-bold text-white">Injected Wallet</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    MetaMask, Rabby, Coinbase Wallet
                  </div>
                </div>
                <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Connect →
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
export default Header;
