// SPDX-License-Identifier: MIT
'use client';

import React, { useState } from 'react';
import type { PoolKey, LiquidityCheckResult } from '../lib/types';
import { computeRouteId } from '../lib/routeId';

export interface MintFlowProps {
  poolKey: PoolKey;
  tokenSymbol: string;
  settlementSymbol: string;
  oraclePrice: number;
  onConfirmMint: (routeId: string) => void;
}

export const MintFlow: React.FC<MintFlowProps> = ({
  poolKey,
  tokenSymbol,
  settlementSymbol,
  oraclePrice,
  onConfirmMint,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [units, setUnits] = useState<number>(1);
  const [durationHours, setDurationHours] = useState<number>(24);
  const [ratePerHour] = useState<number>(0.002); // 0.2% per hour
  const [isCurated] = useState<boolean>(true);

  // Liquidity status simulated check (§6.1, §9.2)
  const [liquidityStatus] = useState<'GREEN' | 'YELLOW' | 'RED'>('GREEN');
  const routeId = computeRouteId(poolKey);

  const premium = units * durationHours * ratePerHour;
  const feeBps = 100; // 1%

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 text-zinc-100 font-sans shadow-xl max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <span className="text-xs text-indigo-400 font-mono tracking-wider uppercase">
            elpi.xyz Mint Flow
          </span>
          <h2 className="text-lg font-bold text-white">
            Mint {tokenSymbol} Fixed-Agreement Option
          </h2>
        </div>
        <div className="text-xs font-mono text-zinc-400">Step {step} of 3</div>
      </div>

      {/* Step 1: Asset and Venue Selection (§9.2 Step 1) */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-zinc-950/60 p-4 border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400 uppercase font-semibold">Matched Venue</span>
              {isCurated ? (
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 border border-emerald-500/20 font-medium">
                  ✓ Verified Pool (ModuleRegistry CURATED)
                </span>
              ) : (
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 border border-amber-500/20 font-medium">
                  Unverified
                </span>
              )}
            </div>
            <div className="font-mono text-sm text-zinc-200">
              Uniswap v4: {tokenSymbol}/{settlementSymbol}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded font-mono border border-indigo-500/20">
                OptionSettlementHook Active (0 AMM Fee Waiver)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400">Position Units</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={units}
                onChange={(e) => setUnits(parseFloat(e.target.value) || 0)}
                className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Duration (Hours)</label>
              <input
                type="number"
                min="1"
                value={durationHours}
                onChange={(e) => setDurationHours(parseInt(e.target.value) || 1)}
                className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-indigo-500 outline-none"
              />
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 text-sm transition-all"
          >
            Review Terms & Liquidity →
          </button>
        </div>
      )}

      {/* Step 2: Terms Review (§9.2 Step 2) */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Venue Liquidity Indicator */}
          <div className="rounded-xl bg-zinc-950/60 p-3.5 border border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-300 font-medium">
              Venue Settlement Liquidity Gate:
            </span>
            {liquidityStatus === 'GREEN' && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block" />
                Sufficient liquidity for position size
              </span>
            )}
            {liquidityStatus === 'YELLOW' && (
              <span className="text-xs text-amber-400 font-semibold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                Thin liquidity — potential slippage
              </span>
            )}
            {liquidityStatus === 'RED' && (
              <span className="text-xs text-rose-400 font-semibold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-400 inline-block" />
                Insufficient liquidity — minting blocked
              </span>
            )}
          </div>

          {/* Fee Breakdown Table */}
          <div className="rounded-xl border border-zinc-800 overflow-hidden text-xs">
            <div className="bg-zinc-950 px-4 py-2.5 font-semibold text-zinc-400 uppercase tracking-wider text-[11px] border-b border-zinc-800">
              Fee Breakdown
            </div>
            <div className="divide-y divide-zinc-800/60 font-mono">
              <div className="px-4 py-2.5 flex justify-between bg-zinc-900/40">
                <span className="text-zinc-400">Premium (Paid Now)</span>
                <span className="text-white font-medium">
                  {premium.toFixed(4)} {settlementSymbol}
                </span>
              </div>
              <div className="px-4 py-2.5 flex justify-between bg-zinc-900/40">
                <span className="text-zinc-400">AMM Fee at Settlement</span>
                <span className="text-emerald-400 font-medium">
                  0 bps (Waived by OptionSettlementHook)
                </span>
              </div>
              <div className="px-4 py-2.5 flex justify-between bg-zinc-900/40">
                <span className="text-zinc-400">Protocol Fee (if profitable)</span>
                <span className="text-zinc-300 font-medium">{feeBps / 100}% of payout</span>
              </div>
              <div className="px-4 py-2.5 flex justify-between bg-zinc-950">
                <span className="text-zinc-300 font-semibold">Oracle Reference Spot</span>
                <span className="text-white font-bold">${oraclePrice.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="w-1/3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-2.5 text-sm"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={liquidityStatus === 'RED'}
              className="w-2/3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium py-2.5 text-sm transition-all"
            >
              Proceed to Sign →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm and Sign (§9.2 Step 3) */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-zinc-950/80 p-4 border border-zinc-800 space-y-3 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-zinc-400">Entry Price:</span>
              <span className="text-white font-semibold">${oraclePrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Expiry (Local Time):</span>
              <span className="text-zinc-200">
                {new Date(Date.now() + durationHours * 3600 * 1000).toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-t border-zinc-800/80 pt-2">
              <span className="text-zinc-400">routeId (Committed at Mint):</span>
              <span className="text-zinc-300 break-all text-[11px] bg-zinc-900 p-2 rounded border border-zinc-800">
                {routeId}
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="w-1/3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-2.5 text-sm"
            >
              ← Back
            </button>
            <button
              onClick={() => onConfirmMint(routeId)}
              className="w-2/3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 text-sm transition-all shadow-lg shadow-emerald-900/30"
            >
              Sign & Mint Position
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
