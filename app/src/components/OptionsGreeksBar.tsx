// SPDX-License-Identifier: MIT
'use client';

import React from 'react';
import type { OptionGreeks } from '@/lib/premiumEstimation';

interface OptionsGreeksBarProps {
  greeks: OptionGreeks;
  impliedVol: number;
  efficiency?: 'DISCOUNT' | 'FAIR' | 'PREMIUM';
}

export const OptionsGreeksBar: React.FC<OptionsGreeksBarProps> = ({
  greeks,
  impliedVol,
  efficiency = 'DISCOUNT',
}) => {
  return (
    <div className="glass-panel rounded-2xl p-3 border border-[#2D2F3F]/80 grid grid-cols-5 gap-2 text-center font-mono">
      {/* Delta */}
      <div className="border-r border-white/5 pr-1">
        <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
          Delta
        </div>
        <div className="text-sm font-bold text-stitch-tertiary-bright mt-0.5">
          {greeks.delta >= 0 ? `+${greeks.delta.toFixed(2)}` : greeks.delta.toFixed(2)}
        </div>
      </div>

      {/* Gamma */}
      <div className="border-r border-white/5 pr-1">
        <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
          Gamma
        </div>
        <div className="text-sm font-bold text-white mt-0.5">
          {greeks.gamma.toFixed(4)}
        </div>
      </div>

      {/* Theta */}
      <div className="border-r border-white/5 pr-1">
        <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
          Theta / Day
        </div>
        <div className="text-sm font-bold text-uni-red mt-0.5">
          {greeks.thetaPerDay.toFixed(2)}
        </div>
      </div>

      {/* Vega */}
      <div className="border-r border-white/5 pr-1">
        <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
          Vega
        </div>
        <div className="text-sm font-bold text-uni-blue mt-0.5">
          {greeks.vega.toFixed(2)}
        </div>
      </div>

      {/* Implied Volatility & Pricing */}
      <div>
        <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center justify-center gap-1">
          <span>IV</span>
          <span
            className={`text-[9px] px-1 rounded ${
              efficiency === 'DISCOUNT'
                ? 'bg-stitch-tertiary/20 text-stitch-tertiary-bright'
                : 'bg-uni-pink-subtle text-uni-pink'
            }`}
          >
            {efficiency}
          </span>
        </div>
        <div className="text-sm font-bold text-uni-pink mt-0.5">
          {(impliedVol * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
};
