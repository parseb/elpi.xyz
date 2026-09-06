// SPDX-License-Identifier: MIT
'use client';

import React from 'react';
import { ElpiLogo } from '@/components/ElpiLogo';

interface InvariantsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InvariantsModal: React.FC<InvariantsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const invariants = [
    {
      id: 'I1',
      title: 'Bounded Insolvency',
      badge: 'Collateral Isolation',
      color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
      tagColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      description:
        'Collateral lives in an isolated PositionAccount bound 1:1 to one position. Settling position A can never touch or seize position B collateral. Insolvency is strictly bounded to a single position.',
      proof: 'Tested via UniswapV4Invariant.t.sol: 2,048 random state calls with 0 reverts.',
    },
    {
      id: 'I2',
      title: 'Term Immutability',
      badge: 'CREATE2 Binding',
      color: 'border-uni-blue/30 bg-uni-blue/5 text-uni-blue',
      tagColor: 'bg-uni-blue/10 text-uni-blue border-uni-blue/20',
      description:
        'Every single term — including oracle address, settlement venue, and routeId — is immutable from mint time. Committed by CREATE2 address derivation via TermsLib.termsSalt. No admin or governance can mutate a live position.',
      proof: 'Tested via UniswapV4VenueAdapter: registerRoute is append-only; route collisions revert.',
    },
    {
      id: 'I3',
      title: 'Venue-Free Recovery',
      badge: 'Guaranteed Unwind',
      color: 'border-uni-pink/30 bg-uni-pink/5 text-uni-pink',
      tagColor: 'bg-uni-pink/10 text-uni-pink border-uni-pink/20',
      description:
        'At least one settlement path — settleToLp via ExpiryCondition — never depends on the oracle, venue, arbiter, or Uniswap pool. Computable from block.timestamp alone, ensuring LP capital is never trapped if external venues halt.',
      proof: 'Verified in V4LiquidityVaultTest: settleToLp succeeds even when oracle or venue unconditionally reverts.',
    },
    {
      id: 'I4',
      title: 'Fee Base Protection',
      badge: '0 AMM Fee Waiver',
      color: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
      tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      description:
        'Protocol fee (100 bps / 1%) is withheld from taker-directed profitable payouts, rounded up. OptionSettlementHook waives Uniswap AMM swap fees (overrideFee = 0) so swap costs do not distort or dilute the fee base.',
      proof: 'Verified in OptionSettlementHookTest: beforeSwap overrides fee to 0 on all verified PositionAccounts.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-2xl rounded-3xl bg-[#13141E] border border-white/10 p-6 md:p-8 space-y-6 shadow-uni-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ElpiLogo size="sm" showBadge={true} badgeText="Invariants" />
              </div>
              <p className="text-xs text-uni-muted mt-1">
                Mathematical guarantees enforced on Base × Uniswap v4 (OH_UNISWAP)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Invariant Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {invariants.map((inv) => (
            <div
              key={inv.id}
              className={`rounded-2xl border p-4 space-y-2.5 transition-all hover:scale-[1.01] ${inv.color}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-black tracking-wider">
                  [{inv.id}] {inv.title}
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${inv.tagColor}`}
                >
                  {inv.badge}
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed font-sans">{inv.description}</p>
              <div className="pt-2 border-t border-white/5 text-[11px] font-mono text-uni-muted flex items-center gap-1.5">
                <span className="text-emerald-400">✓</span> {inv.proof}
              </div>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-3.5 flex items-center justify-between text-xs font-mono text-uni-muted">
          <span>Security Model: Non-custodial isolated vault architecture</span>
          <a
            href="https://elpi.xyz"
            target="_blank"
            rel="noreferrer"
            className="text-uni-pink hover:text-uni-pink-light transition-colors font-sans font-medium"
          >
            Read Master Architecture →
          </a>
        </div>
      </div>
    </div>
  );
};
