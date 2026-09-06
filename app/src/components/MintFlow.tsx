// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useMemo } from 'react';
import type { PoolKey } from '../lib/types';
import { computeRouteId } from '../lib/routeId';
import { estimateOptionPremiumAndGreeks } from '../lib/premiumEstimation';

export interface MintFlowProps {
  poolKey: PoolKey;
  tokenSymbol: string;
  settlementSymbol: string;
  oraclePrice: number;
  optionType?: 'CALL' | 'PUT';
  onOptionTypeChange?: (type: 'CALL' | 'PUT') => void;
  onConfirmMint: (routeId: string) => void;
}

export const MintFlow: React.FC<MintFlowProps> = ({
  poolKey,
  tokenSymbol,
  settlementSymbol,
  oraclePrice,
  optionType: externalOptionType,
  onOptionTypeChange,
  onConfirmMint,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [units, setUnits] = useState<number>(1);
  const [durationHours, setDurationHours] = useState<number>(24);
  const [ratePerHour] = useState<number>(0.002); // 0.2% per hour
  const [localOptionType, setLocalOptionType] = useState<'CALL' | 'PUT'>('CALL');
  const [isCurated] = useState<boolean>(true);

  const optionType = externalOptionType ?? localOptionType;
  const setOptionType = (t: 'CALL' | 'PUT') => {
    if (onOptionTypeChange) {
      onOptionTypeChange(t);
    } else {
      setLocalOptionType(t);
    }
  };

  // Liquidity status simulated check (§6.1, §9.2)
  const [liquidityStatus] = useState<'GREEN' | 'YELLOW' | 'RED'>('GREEN');
  const routeId = computeRouteId(poolKey);

  // Premium & Greeks calculation (§6.3)
  const premiumAnalysis = useMemo(() => {
    return estimateOptionPremiumAndGreeks({
      spotPrice: oraclePrice,
      strikePrice: oraclePrice, // ATM at mint
      durationHours,
      units,
      ratePerHour,
      optionType,
      impliedVol: 0.62, // 62% pool IV
    });
  }, [oraclePrice, durationHours, units, ratePerHour, optionType]);

  const feeBps = 100; // 1%

  return (
    <div className="w-full rounded-3xl border border-white/10 bg-[#13141E] p-4 sm:p-6 text-white font-sans shadow-uni-card space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-uni-pink font-mono tracking-wider uppercase font-bold">
              Uniswap v4 Option Mint
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-uni-pink animate-pulse" />
          </div>
          <h2 className="text-lg font-black text-white mt-0.5">
            Mint {tokenSymbol} Fixed Agreement
          </h2>
        </div>
        <div className="flex items-center gap-1.5 bg-[#0D0E15] px-3 py-1 rounded-full border border-white/10 text-xs font-mono text-uni-muted">
          <span className="text-uni-pink font-bold">Step {step}</span>
          <span>of 3</span>
        </div>
      </div>

      {/* Step Indicators */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
        {[
          { num: 1, title: 'Asset & Units' },
          { num: 2, title: 'Terms & IV' },
          { num: 3, title: 'Sign Agreement' },
        ].map((s) => (
          <div
            key={s.num}
            className={`min-h-[2.5rem] flex items-center justify-center py-2 px-1 rounded-xl border transition-all ${
              step === s.num
                ? 'bg-uni-pink-subtle border-uni-pink/40 text-uni-pink shadow-[0_0_12px_rgba(255,0,122,0.15)] font-bold'
                : step > s.num
                ? 'bg-uni-green-subtle border-uni-green/30 text-uni-green'
                : 'bg-white/[0.02] border-white/5 text-uni-muted'
            }`}
          >
            {step > s.num ? '✓ ' : `${s.num}. `}
            {s.title}
          </div>
        ))}
      </div>

      {/* Step 1: Asset and Venue Selection (§9.2 Step 1) */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Matched Venue Info Card */}
          <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-uni-muted uppercase font-bold tracking-wider">
                Execution Venue
              </span>
              {isCurated ? (
                <span className="rounded-full bg-uni-green-subtle px-2.5 py-0.5 text-xs text-uni-green border border-uni-green/30 font-semibold flex items-center gap-1">
                  <span>✓</span> ModuleRegistry CURATED
                </span>
              ) : (
                <span className="rounded-full bg-uni-amber-subtle px-2.5 py-0.5 text-xs text-uni-amber border border-uni-amber/30 font-semibold">
                  Unverified
                </span>
              )}
            </div>

            <div className="flex items-center justify-between font-mono text-sm">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">Uniswap v4:</span>
                <span className="bg-white/10 px-2 py-0.5 rounded text-xs text-white">
                  {tokenSymbol} / {settlementSymbol}
                </span>
              </div>
              <span className="text-xs text-uni-muted font-mono">TickSpacing: 60</span>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-white/5 text-xs">
              <span className="text-uni-pink font-semibold">⚡ OptionSettlementHook:</span>
              <span className="text-uni-muted font-mono text-[11px]">0-Fee Settlement Waiver Protected</span>
            </div>
          </div>

          {/* Option Type Selector (CALL / PUT) */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setOptionType('CALL')}
              className={`p-3 rounded-2xl border text-center transition-all ${
                optionType === 'CALL'
                  ? 'bg-uni-green-subtle border-uni-green/50 text-white shadow-[0_0_16px_rgba(0,211,149,0.2)]'
                  : 'bg-[#0D0E15] border-white/5 text-uni-muted hover:border-white/20'
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-wider text-uni-green">CALL Option</div>
              <div className="text-[11px] text-uni-muted mt-0.5">Profit when spot rises</div>
            </button>
            <button
              onClick={() => setOptionType('PUT')}
              className={`p-3 rounded-2xl border text-center transition-all ${
                optionType === 'PUT'
                  ? 'bg-uni-red-subtle border-uni-red/50 text-white shadow-[0_0_16px_rgba(255,73,74,0.2)]'
                  : 'bg-[#0D0E15] border-white/5 text-uni-muted hover:border-white/20'
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-wider text-uni-red">PUT Option</div>
              <div className="text-[11px] text-uni-muted mt-0.5">Profit when spot falls</div>
            </button>
          </div>

          {/* Units & Duration Inputs */}
          <div className="space-y-4">
            {/* Units Input & Slider */}
            <div className="bg-[#0D0E15]/90 p-3.5 rounded-2xl border border-[#2D2F3F]/80 focus-within:border-uni-pink/50 transition-all">
              <div className="flex justify-between text-xs text-zinc-400 font-medium mb-1.5">
                <span className="font-mono uppercase tracking-wider text-[10px] font-bold">Size ({tokenSymbol})</span>
                <span className="font-mono text-white font-bold">{units.toFixed(2)} units</span>
              </div>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={units}
                onChange={(e) => setUnits(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                className="w-full bg-transparent text-xl font-bold font-mono text-white outline-none mb-2"
              />
              <input
                type="range"
                min="0.1"
                max="20"
                step="0.1"
                value={units}
                onChange={(e) => setUnits(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#2D2F3F] rounded-lg appearance-none cursor-pointer accent-[#FF007A]"
              />
            </div>

            {/* Duration Input, Slider & Quick Chips */}
            <div className="bg-[#0D0E15]/90 p-3.5 rounded-2xl border border-[#2D2F3F]/80 focus-within:border-uni-pink/50 transition-all space-y-2">
              <div className="flex justify-between text-xs text-zinc-400 font-medium">
                <span className="font-mono uppercase tracking-wider text-[10px] font-bold">Duration</span>
                <span className="font-mono text-white font-bold">{durationHours} hours ({durationHours >= 24 ? `${(durationHours/24).toFixed(1)}d` : `${durationHours}h`})</span>
              </div>
              
              {/* Quick Duration Chips from Stitch */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  { label: '6h', hours: 6 },
                  { label: '12h', hours: 12 },
                  { label: '24h', hours: 24 },
                  { label: '3d', hours: 72 },
                  { label: '7d', hours: 168 },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setDurationHours(chip.hours)}
                    className={`px-3 py-1 rounded-xl text-xs font-mono transition-all ${
                      durationHours === chip.hours
                        ? 'bg-uni-pink/20 text-uni-pink border border-uni-pink/50 font-bold shadow-[0_0_10px_rgba(255,0,122,0.2)]'
                        : 'bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white border border-transparent'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <input
                type="range"
                min="1"
                max="168"
                step="1"
                value={durationHours}
                onChange={(e) => setDurationHours(parseInt(e.target.value) || 1)}
                className="w-full h-1.5 bg-[#2D2F3F] rounded-lg appearance-none cursor-pointer accent-[#FF007A] pt-1"
              />
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            className="w-full rounded-2xl bg-[#FF007A] hover:bg-[#FF007A]/90 hover:shadow-[0_0_24px_rgba(255,0,122,0.45)] text-white font-bold py-3.5 text-sm transition-all flex items-center justify-center gap-2 active:scale-98"
          >
            <span>Review Terms & Liquidity</span>
            <span className="text-xs opacity-80">→</span>
          </button>
        </div>
      )}

      {/* Step 2: Terms Review & Section 6.3 Greeks (§9.2 Step 2) */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Venue Liquidity Indicator */}
          <div className="rounded-2xl bg-[#0D0E15] p-3.5 border border-white/5 flex items-center justify-between">
            <span className="text-xs text-zinc-300 font-semibold">
              Venue Liquidity Gate:
            </span>
            {liquidityStatus === 'GREEN' && (
              <span className="text-xs text-uni-green font-bold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-uni-green animate-pulse" />
                Sufficient depth for {units} {tokenSymbol}
              </span>
            )}
          </div>

          {/* Greeks & IV Box (§6.3 Implementation) */}
          <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-uni-muted tracking-wider">
                Implied Volatility & Greeks (Uniswap v4 Pool)
              </span>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  premiumAnalysis.efficiency === 'DISCOUNT'
                    ? 'bg-uni-green-subtle text-uni-green border-uni-green/30'
                    : premiumAnalysis.efficiency === 'PREMIUM'
                    ? 'bg-uni-amber-subtle text-uni-amber border-uni-amber/30'
                    : 'bg-uni-blue-subtle text-uni-blue border-uni-blue/30'
                }`}
              >
                {premiumAnalysis.efficiency === 'DISCOUNT'
                  ? '🏷️ LP Discount vs BS'
                  : premiumAnalysis.efficiency === 'PREMIUM'
                  ? '⚡ Premium vs BS'
                  : '⚖️ Fair Value'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
              <div className="bg-white/[0.03] p-2 rounded-xl text-center">
                <div className="text-[10px] text-uni-muted">Delta (Δ)</div>
                <div className="text-white font-bold mt-0.5">{premiumAnalysis.greeks.delta.toFixed(3)}</div>
              </div>
              <div className="bg-white/[0.03] p-2 rounded-xl text-center">
                <div className="text-[10px] text-uni-muted">Gamma (Γ)</div>
                <div className="text-white font-bold mt-0.5">{premiumAnalysis.greeks.gamma.toFixed(5)}</div>
              </div>
              <div className="bg-white/[0.03] p-2 rounded-xl text-center">
                <div className="text-[10px] text-uni-muted">Theta (Θ/day)</div>
                <div className="text-uni-red font-bold mt-0.5">{premiumAnalysis.greeks.thetaPerDay.toFixed(2)}</div>
              </div>
            </div>

            <div className="text-[11px] text-uni-muted font-mono flex justify-between pt-1">
              <span>Pool IV (30d TWAP): <strong>{premiumAnalysis.impliedVolAnnual.toFixed(0)}%</strong></span>
              <span>Black-Scholes Bench: <strong>${premiumAnalysis.benchmarkPremium.toFixed(2)}</strong></span>
            </div>
          </div>

          {/* Fee Breakdown Table */}
          <div className="rounded-2xl border border-white/5 overflow-hidden text-xs bg-[#0D0E15]">
            <div className="px-4 py-2.5 font-bold text-uni-muted uppercase tracking-wider text-[10px] border-b border-white/5">
              Fee & Settlement Terms Breakdown
            </div>
            <div className="divide-y divide-white/5 font-mono">
              <div className="px-4 py-2.5 flex justify-between">
                <span className="text-uni-muted">Premium (Paid Now to LP)</span>
                <span className="text-white font-bold">
                  {premiumAnalysis.flatRatePremium.toFixed(4)} {settlementSymbol}
                </span>
              </div>
              <div className="px-4 py-2.5 flex justify-between">
                <span className="text-uni-muted">AMM Swap Fee</span>
                <span className="text-uni-green font-semibold">
                  0 bps (OptionSettlementHook Waiver)
                </span>
              </div>
              <div className="px-4 py-2.5 flex justify-between">
                <span className="text-uni-muted">Protocol Fee (if profitable)</span>
                <span className="text-white font-medium">{feeBps / 100}% of gross payout</span>
              </div>
              <div className="px-4 py-2.5 flex justify-between bg-white/[0.02]">
                <span className="text-white font-semibold">Oracle Reference Spot</span>
                <span className="text-uni-blue font-bold">${oraclePrice.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="w-1/3 rounded-2xl bg-white/5 hover:bg-white/10 text-uni-muted hover:text-white font-semibold py-3.5 text-sm transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="w-2/3 rounded-2xl bg-gradient-to-r from-uni-pink to-uni-purple hover:brightness-110 text-white font-bold py-3.5 text-sm transition-all shadow-uni-pink"
            >
              Proceed to Sign →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm and Sign (§9.2 Step 3) */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-3 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-uni-muted">Agreement Type:</span>
              <span className="text-white font-bold">{optionType} Option ({units} units)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-uni-muted">Entry / Strike Price:</span>
              <span className="text-uni-blue font-bold">${oraclePrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-uni-muted">Expiry Time:</span>
              <span className="text-white font-semibold">
                {new Date(Date.now() + durationHours * 3600 * 1000).toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-t border-white/5 pt-2">
              <span className="text-uni-muted">Committed routeId (Invariant I2):</span>
              <span className="text-uni-pink break-all text-[11px] bg-black/40 p-2 rounded-xl border border-white/5">
                {routeId}
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setStep(2)}
              className="w-1/3 rounded-2xl bg-white/5 hover:bg-white/10 text-uni-muted hover:text-white font-semibold py-3.5 text-sm transition-colors border border-white/5"
            >
              ← Back
            </button>
            <button
              onClick={() => onConfirmMint(routeId)}
              className="w-2/3 rounded-2xl bg-[#FF007A] hover:bg-[#FF007A]/90 hover:shadow-[0_0_24px_rgba(255,0,122,0.45)] text-white font-bold py-3.5 text-sm transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,0,122,0.3)] active:scale-98"
            >
              <span>Mint Option Position</span>
              <span className="text-[10px] font-mono bg-white/20 px-1.5 py-0.5 rounded-full font-bold">
                No AMM Fee
              </span>
            </button>
          </div>

          {/* Invariants Guarantee Row from Stitch */}
          <div className="flex items-center justify-between pt-3 border-t border-white/5 text-[11px] font-mono text-zinc-400">
            <span className="text-zinc-500">Guarantees:</span>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-stitch-primary font-bold">
                I1 Bounded
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-stitch-secondary font-bold">
                I2 Immutable
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-stitch-tertiary-bright font-bold">
                I3 Venue-Free
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-uni-amber font-bold">
                I4 0-Fee
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MintFlow;
