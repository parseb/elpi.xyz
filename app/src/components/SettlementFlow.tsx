// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useMemo } from 'react';

export interface SettlementFlowProps {
  positionId: string;
  optionType: 'CALL' | 'PUT';
  entryPrice: number;
  currentOraclePrice: number;
  maxPriceAgeSeconds: number;
  lastOracleUpdateTimestamp: number;
  units: number;
  scalar: number;
  feeBps: number; // 100 = 1%
  settlementSymbol: string;
  onExecuteSettlement: (minPayout: number, isDirectLp: boolean) => void;
}

export const SettlementFlow: React.FC<SettlementFlowProps> = ({
  positionId,
  optionType,
  entryPrice,
  currentOraclePrice,
  maxPriceAgeSeconds,
  lastOracleUpdateTimestamp,
  units,
  scalar,
  feeBps,
  settlementSymbol,
  onExecuteSettlement,
}) => {
  const [slippageBps, setSlippageBps] = useState<number>(50); // 0.5% default
  const [isLpPresent, setIsLpPresent] = useState<boolean>(true);

  // 1. Live Price Widget Freshness (§9.4.1)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.max(0, nowSeconds - lastOracleUpdateTimestamp);
  const isStale = ageSeconds > maxPriceAgeSeconds;
  const isWarningAge = ageSeconds > maxPriceAgeSeconds * 0.9;

  // 2. Profit Calculator (§9.4.2)
  // Matching TakerProfitCondition formula:
  // CALL: pnl = max(0, (livePrice - entryPrice) * units)
  // PUT:  pnl = max(0, (entryPrice - livePrice) * units)
  const grossPayout = useMemo(() => {
    let diff = 0;
    if (optionType === 'CALL') {
      diff = Math.max(0, currentOraclePrice - entryPrice);
    } else {
      diff = Math.max(0, entryPrice - currentOraclePrice);
    }
    return diff * units;
  }, [optionType, currentOraclePrice, entryPrice, units]);

  const protocolFee = grossPayout > 0 ? (grossPayout * feeBps) / 10000 : 0;
  const netPayout = Math.max(0, grossPayout - protocolFee);

  // 4. minPayoutToTaker slider range (§9.4.4)
  // Min: netPayout * (1 - slippageBps / 10000)
  // Max: netPayout
  const minPayout = useMemo(() => {
    return (netPayout * (10000 - slippageBps)) / 10000;
  }, [netPayout, slippageBps]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 text-zinc-100 font-sans shadow-xl max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <span className="text-xs text-indigo-400 font-mono tracking-wider uppercase">
            elpi.xyz Settlement
          </span>
          <h2 className="text-lg font-bold text-white">
            Position #{positionId} ({optionType})
          </h2>
        </div>
        <span className="rounded bg-zinc-800 px-2.5 py-1 text-xs font-mono text-zinc-300">
          Units: {units}
        </span>
      </div>

      {/* 1. Live Price Widget (§9.4.1) */}
      <div className="rounded-xl bg-zinc-950/70 p-4 border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Chainlink Reference Price</span>
          <span
            className={`font-mono font-medium ${
              isStale
                ? 'text-rose-400'
                : isWarningAge
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}
          >
            {isStale
              ? '● Stale Feed (Revert Risk)'
              : isWarningAge
              ? '● Approaching Max Age'
              : '● Live Feed Fresh'}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-2xl font-bold font-mono text-white">
            ${currentOraclePrice.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-400 font-mono">
            Entry: ${entryPrice.toLocaleString()} (
            {((currentOraclePrice / entryPrice - 1) * 100).toFixed(2)}%)
          </div>
        </div>
      </div>

      {/* 2. Profit & Fee Calculator (§9.4.2) */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden text-xs">
        <div className="bg-zinc-950 px-4 py-2.5 font-semibold text-zinc-400 uppercase tracking-wider text-[11px] border-b border-zinc-800">
          Settlement Payout Breakdown
        </div>
        <div className="divide-y divide-zinc-800/60 font-mono">
          <div className="px-4 py-2.5 flex justify-between bg-zinc-900/40">
            <span className="text-zinc-400">Gross In-The-Money Payout</span>
            <span className="text-white font-medium">
              {grossPayout.toFixed(4)} {settlementSymbol}
            </span>
          </div>
          <div className="px-4 py-2.5 flex justify-between bg-zinc-900/40">
            <span className="text-zinc-400">AMM Swap Fee (v4 Hook Waiver)</span>
            <span className="text-emerald-400 font-medium">0 bps (0.00 {settlementSymbol})</span>
          </div>
          <div className="px-4 py-2.5 flex justify-between bg-zinc-900/40">
            <span className="text-zinc-400">Protocol Fee ({feeBps / 100}%)</span>
            <span className="text-zinc-300 font-medium">
              -{protocolFee.toFixed(4)} {settlementSymbol}
            </span>
          </div>
          <div className="px-4 py-3 flex justify-between bg-zinc-950">
            <span className="text-zinc-200 font-semibold text-sm">Estimated Net Payout</span>
            <span className="text-emerald-400 font-bold text-sm">
              {netPayout.toFixed(4)} {settlementSymbol}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Min Payout Slider (§9.4.4) */}
      <div className="space-y-2 rounded-xl bg-zinc-950/50 p-4 border border-zinc-800">
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Slippage Tolerance (Min Payout Floor):</span>
          <span className="font-mono text-zinc-200 font-medium">
            {(slippageBps / 100).toFixed(2)}% ({minPayout.toFixed(4)} {settlementSymbol})
          </span>
        </div>
        <input
          type="range"
          min="10"
          max="200"
          step="10"
          value={slippageBps}
          onChange={(e) => setSlippageBps(parseInt(e.target.value))}
          className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
        <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
          <span>0.1% (Strict Floor)</span>
          <span>1.0%</span>
          <span>2.0% (Relaxed)</span>
        </div>
      </div>

      {/* 5. Settlement Path Display (§9.4.5) */}
      <div className="rounded-xl bg-zinc-950/70 p-3.5 border border-zinc-800 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Settlement Authorization Path:</span>
          <button
            onClick={() => setIsLpPresent(!isLpPresent)}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
          >
            Switch Mode (Testing)
          </button>
        </div>
        <div className="font-medium text-zinc-200">
          {isLpPresent ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span>●</span> Direct 2-of-2 Settlement (LP + Taker) — Fastest, zero referee gas
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-indigo-400">
              <span>●</span> Arbiter-Assisted (Taker + ConditionArbiter) — Permissionless
            </span>
          )}
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={() => onExecuteSettlement(minPayout, isLpPresent)}
        disabled={isStale || netPayout <= 0}
        className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium py-3 text-sm transition-all shadow-lg shadow-emerald-900/30 font-semibold"
      >
        {isStale
          ? 'Cannot Settle: Stale Oracle'
          : netPayout <= 0
          ? 'Position Out of The Money'
          : `Execute SettleToTaker (Receive ≥ ${minPayout.toFixed(4)} ${settlementSymbol})`}
      </button>
    </div>
  );
};
