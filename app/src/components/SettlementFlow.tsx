// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useMemo } from 'react';
import {
  computeOptionSettlement,
  computeSlippageFloor,
  OptionSettlementResult,
} from '@/lib/settlementMath';

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
  underlyingSymbol?: string;
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
  scalar: _scalar,
  feeBps,
  settlementSymbol,
  underlyingSymbol = 'WETH',
  onExecuteSettlement,
}) => {
  const [slippageBps, setSlippageBps] = useState<number>(50); // 0.5% default
  const [isLpPresent, setIsLpPresent] = useState<boolean>(true);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulatedPrice, setSimulatedPrice] = useState<number>(currentOraclePrice);

  // 1. Live Price Widget Freshness (§9.4.1)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.max(0, nowSeconds - lastOracleUpdateTimestamp);
  const isStale = !isSimulating && ageSeconds > maxPriceAgeSeconds;
  const isWarningAge = !isSimulating && ageSeconds > maxPriceAgeSeconds * 0.9;

  // Active price evaluated (live oracle or simulated)
  const activeSpotPrice = isSimulating ? simulatedPrice : currentOraclePrice;

  // 2. Exact Settlement Math (Mirrors OptionCore & OptionLifecycleE2ETest)
  const settlement: OptionSettlementResult = useMemo(() => {
    return computeOptionSettlement({
      optionType,
      strikePrice: entryPrice,
      spotPrice: activeSpotPrice,
      units,
      feeBps,
    });
  }, [optionType, entryPrice, activeSpotPrice, units, feeBps]);

  // Slippage tolerance floor
  const minPayout = useMemo(() => {
    return computeSlippageFloor(settlement.netPayout, slippageBps);
  }, [settlement.netPayout, slippageBps]);

  // Slider bounds based on strike price ($0.2x to $3.0x)
  const minSliderPrice = Math.max(100, Math.round(entryPrice * 0.2));
  const maxSliderPrice = Math.round(entryPrice * 3.0);
  const sliderStep = Math.max(1, Math.round(entryPrice / 200));

  // Quick preset handlers
  const handlePreset = (multiplier: number) => {
    setIsSimulating(true);
    setSimulatedPrice(Math.round(entryPrice * multiplier));
  };

  return (
    <div className="w-full rounded-3xl border border-white/10 bg-[#13141E] p-4 sm:p-6 text-white font-sans shadow-uni-card space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-uni-pink font-mono tracking-wider uppercase font-bold">
              Uniswap v4 Settlement
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-uni-pink animate-pulse" />
          </div>
          <h2 className="text-lg font-black text-white mt-0.5">
            Position #{positionId} ({optionType})
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/5 border border-white/10 px-3 py-1 text-xs font-mono text-uni-muted font-semibold">
            {units} {underlyingSymbol}
          </span>
          <button
            onClick={() => {
              setIsSimulating(!isSimulating);
              if (!isSimulating) setSimulatedPrice(currentOraclePrice);
            }}
            className={`rounded-full px-3 py-1 text-xs font-mono font-bold transition-all border ${
              isSimulating
                ? 'bg-uni-pink/20 border-uni-pink text-uni-pink shadow-[0_0_12px_rgba(255,0,122,0.3)]'
                : 'bg-white/5 border-white/10 text-uni-muted hover:text-white hover:border-white/20'
            }`}
          >
            {isSimulating ? 'Simulating' : 'Simulate'}
          </button>
        </div>
      </div>

      {/* 1. Price Widget: Live or Simulator */}
      <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-uni-muted font-medium flex items-center gap-1.5">
            {isSimulating ? (
              <span className="text-uni-pink font-bold">Interactive Price Simulator</span>
            ) : (
              'Chainlink Oracle Reference'
            )}
          </span>
          <span
            className={`font-mono text-xs font-bold flex items-center gap-1.5 ${
              isSimulating
                ? 'text-uni-pink'
                : isStale
                ? 'text-uni-red'
                : isWarningAge
                ? 'text-uni-amber'
                : 'text-uni-green'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isSimulating
                  ? 'bg-uni-pink animate-ping'
                  : isStale
                  ? 'bg-uni-red'
                  : isWarningAge
                  ? 'bg-uni-amber'
                  : 'bg-uni-green animate-pulse'
              }`}
            />
            {isSimulating
              ? 'Simulation Active'
              : isStale
              ? 'Stale Feed (Revert Risk)'
              : isWarningAge
              ? 'Approaching Max Age'
              : 'Live Feed Fresh'}
          </span>
        </div>

        <div className="flex items-baseline justify-between pt-1">
          <div>
            <div className="text-3xl font-black font-mono text-white">
              ${activeSpotPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-uni-muted font-mono mt-0.5">
              Strike: ${entryPrice.toLocaleString()} {settlementSymbol}
            </div>
          </div>
          <div className="text-right">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full font-mono text-xs font-black ${
                settlement.pricePercentageMove > 0
                  ? 'bg-uni-green/10 text-uni-green border border-uni-green/20'
                  : settlement.pricePercentageMove < 0
                  ? 'bg-uni-red/10 text-uni-red border border-uni-red/20'
                  : 'bg-white/5 text-uni-muted border border-white/10'
              }`}
            >
              {settlement.pricePercentageMove >= 0 ? '+' : ''}
              {settlement.pricePercentageMove.toFixed(2)}%
            </span>
            <div className="text-[10px] text-uni-muted font-mono mt-1">
              {settlement.isITM ? (
                <span className="text-uni-green font-semibold">IN-THE-MONEY</span>
              ) : (
                <span className="text-uni-muted">OUT-OF-THE-MONEY</span>
              )}
            </div>
          </div>
        </div>

        {/* Simulator Slider & Presets */}
        {isSimulating && (
          <div className="pt-2 border-t border-white/5 space-y-2.5">
            <div className="flex justify-between text-[11px] font-mono text-uni-muted">
              <span>Spot Price Slider:</span>
              <span className="text-white font-bold">${simulatedPrice.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={minSliderPrice}
              max={maxSliderPrice}
              step={sliderStep}
              value={simulatedPrice}
              onChange={(e) => setSimulatedPrice(parseFloat(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-uni-pink"
            />
            {/* Quick Movement Presets matching E2E test cases */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                onClick={() => handlePreset(0.1)}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] font-mono text-uni-red border border-white/5"
              >
                -90% Crash
              </button>
              <button
                onClick={() => handlePreset(0.72)}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] font-mono text-uni-amber border border-white/5"
              >
                -28% Bearish
              </button>
              <button
                onClick={() => handlePreset(1.0)}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] font-mono text-uni-muted border border-white/5"
              >
                ATM ($2,500)
              </button>
              <button
                onClick={() => handlePreset(1.28)}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] font-mono text-uni-green border border-white/5"
              >
                +28% Bullish
              </button>
              <button
                onClick={() => handlePreset(2.5)}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] font-mono text-uni-pink border border-white/5"
              >
                +150% Rally
              </button>
              <button
                onClick={() => {
                  setSimulatedPrice(currentOraclePrice);
                  setIsSimulating(false);
                }}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-white ml-auto"
              >
                Reset Live
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Profit & Collateral Breakdown (§9.4.2 & Invariant I1) */}
      <div className="rounded-2xl border border-white/5 overflow-hidden text-xs bg-[#0D0E15]">
        <div className="px-4 py-2.5 font-bold text-uni-muted uppercase tracking-wider text-[10px] border-b border-white/5 flex justify-between items-center">
          <span>Settlement Accounting</span>
          <span className="text-uni-pink font-mono text-[9px] uppercase">
            {settlement.isITM ? 'ITM Taker Settlement' : 'OTM LP Restake Recovery (I3)'}
          </span>
        </div>
        <div className="divide-y divide-white/5 font-mono">
          <div className="px-4 py-2.5 flex justify-between">
            <span className="text-uni-muted">Gross ITM Payout</span>
            <span className="text-white font-bold">
              {settlement.grossPayout.toFixed(4)} {settlementSymbol}
            </span>
          </div>
          <div className="px-4 py-2.5 flex justify-between">
            <span className="text-uni-muted">Uniswap v4 AMM Fee (I4)</span>
            <span className="text-uni-green font-semibold">
              0 bps (Waived by OptionSettlementHook)
            </span>
          </div>
          <div className="px-4 py-2.5 flex justify-between">
            <span className="text-uni-muted">Protocol Fee ({feeBps / 100}%)</span>
            <span className="text-uni-pink font-medium">
              -{settlement.protocolFee.toFixed(4)} {settlementSymbol}
            </span>
          </div>
          <div className="px-4 py-3 flex justify-between bg-white/[0.03]">
            <span className="text-white font-bold text-sm">Net Taker Payout</span>
            <span
              className={`font-mono text-base font-black ${
                settlement.isITM ? 'text-uni-green' : 'text-uni-muted'
              }`}
            >
              {settlement.netPayout.toFixed(4)} {settlementSymbol}
            </span>
          </div>
          <div className="px-4 py-2.5 flex justify-between bg-white/[0.01]">
            <span className="text-uni-muted">Unspent LP Collateral Refund (I1)</span>
            <span className="text-uni-blue font-bold">
              {settlement.unspentCollateralToLp.toFixed(4)}{' '}
              {optionType === 'CALL' ? underlyingSymbol : settlementSymbol}
            </span>
          </div>
          <div className="px-4 py-2 flex justify-between text-[10px] text-uni-muted">
            <span>LP Restake Destination</span>
            <span className="text-white font-medium">
              Uniswap v4 Pool (via ILPSettlementHook)
            </span>
          </div>
        </div>
      </div>

      {/* 3. Invariants Guarantee Card */}
      <div className="rounded-2xl bg-[#0D0E15] p-3.5 border border-white/5 space-y-2 text-[11px]">
        <div className="font-bold text-uni-muted uppercase tracking-wider text-[10px]">
          Protocol Invariant Guarantees
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-2 space-y-0.5">
            <div className="text-uni-green font-bold flex items-center gap-1">
              <span>✓</span> I1: Bounded Insolvency
            </div>
            <div className="text-uni-muted">1:1 Collateral Isolation. Adapter Persistent Bal = 0.</div>
          </div>
          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-2 space-y-0.5">
            <div className="text-uni-green font-bold flex items-center gap-1">
              <span>✓</span> I2: Immutability
            </div>
            <div className="text-uni-muted">Deterministic terms in address salt bytecode.</div>
          </div>
          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-2 space-y-0.5">
            <div className="text-uni-green font-bold flex items-center gap-1">
              <span>✓</span> I3: Venue-Free Recovery
            </div>
            <div className="text-uni-muted">Zero-dependency LP recovery on OTM expiry.</div>
          </div>
          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-2 space-y-0.5">
            <div className="text-uni-green font-bold flex items-center gap-1">
              <span>✓</span> I4: Fee Base Protection
            </div>
            <div className="text-uni-muted">100 bps fee baseline with AMM 0 bps waiver.</div>
          </div>
        </div>
      </div>

      {/* 4. Min Payout Slider (§9.4.4) */}
      <div className="space-y-2.5 rounded-2xl bg-[#0D0E15] p-4 border border-white/5">
        <div className="flex justify-between text-xs">
          <span className="text-uni-muted font-medium">Slippage Tolerance Floor:</span>
          <span className="font-mono text-white font-bold">
            {(slippageBps / 100).toFixed(2)}% (≥ {minPayout.toFixed(4)} {settlementSymbol})
          </span>
        </div>
        <input
          type="range"
          min="10"
          max="200"
          step="10"
          value={slippageBps}
          onChange={(e) => setSlippageBps(parseInt(e.target.value))}
          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-uni-pink"
        />
        <div className="flex justify-between text-[10px] text-uni-muted font-mono">
          <span>0.1% (Strict Floor)</span>
          <span>0.5% (Recommended)</span>
          <span>2.0% (Relaxed)</span>
        </div>
      </div>

      {/* 5. Authorization Path (§9.4.5) */}
      <div className="rounded-2xl bg-[#0D0E15] p-3.5 border border-white/5 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-uni-muted font-semibold uppercase tracking-wider text-[10px]">
            Authorization Path
          </span>
          <button
            onClick={() => setIsLpPresent(!isLpPresent)}
            className="text-[11px] text-uni-pink hover:text-uni-pink-light underline font-medium transition-colors"
          >
            Toggle Mode (Testing)
          </button>
        </div>
        <div className="font-medium">
          {isLpPresent ? (
            <span className="flex items-center gap-2 text-uni-green">
              <span className="h-2 w-2 rounded-full bg-uni-green shadow-[0_0_8px_#00D395]" />
              Direct 2-of-2 Settlement (LP + Taker) — Fastest, zero arbiter gas
            </span>
          ) : (
            <span className="flex items-center gap-2 text-uni-blue">
              <span className="h-2 w-2 rounded-full bg-uni-blue shadow-[0_0_8px_#4C82FB]" />
              ConditionArbiter-Assisted (Taker + ConditionArbiter) — Permissionless
            </span>
          )}
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={() => onExecuteSettlement(minPayout, isLpPresent)}
        disabled={isStale || !settlement.isITM}
        className={`w-full rounded-2xl font-bold py-3.5 text-sm transition-all shadow-md ${
          isStale || !settlement.isITM
            ? 'bg-white/5 text-uni-muted cursor-not-allowed border border-white/5'
            : 'bg-gradient-to-r from-uni-green via-emerald-500 to-teal-500 hover:brightness-110 text-white shadow-[0_0_24px_rgba(0,211,149,0.3)] active:scale-[0.99]'
        }`}
      >
        {isStale
          ? 'Cannot Settle: Stale Oracle'
          : !settlement.isITM
          ? 'Position Out-of-The-Money (LP Recovery Only)'
          : `Execute SettleToTaker (Receive ≥ ${minPayout.toFixed(4)} ${settlementSymbol})`}
      </button>
    </div>
  );
};

export default SettlementFlow;
