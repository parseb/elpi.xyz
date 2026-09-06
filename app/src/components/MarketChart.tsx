// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { PoolKey } from '../lib/types';
import { subscribeToPoolSwaps } from '../lib/client';
import type { Hex } from 'viem';

export interface MarketChartProps {
  poolKey: PoolKey;
  entryPrice: number;
  currentOraclePrice: number;
  durationHours: number;
  optionType: 'CALL' | 'PUT';
  positionSize: number;
  slippageBps?: number;
  executable?: boolean;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const MarketChart: React.FC<MarketChartProps> = ({
  poolKey,
  entryPrice,
  currentOraclePrice,
  durationHours,
  optionType,
  positionSize,
  slippageBps = 100,
  executable = true,
}) => {
  const [granularity, setGranularity] = useState<'1h' | '4h' | '1d'>('1h');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [lastLivePrice, setLastLivePrice] = useState<number>(currentOraclePrice);
  const [isClient, setIsClient] = useState<boolean>(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Simulated depth metrics
  const poolDepthWithinSlippage = 120.5; // in ETH / base token units
  const depthRatio = positionSize > 0 ? (poolDepthWithinSlippage / positionSize) * 100 : 999;
  const isHealthyLiquidity = depthRatio >= 100;

  // Generate initial candle series based on current oracle price
  const baseCandles = useMemo<CandleData[]>(() => {
    const candles: CandleData[] = [];
    const intervalSec = granularity === '1h' ? 3600 : granularity === '4h' ? 14400 : 86400;
    const count = 30;
    const now = Math.floor(Date.now() / 1000);
    const start = now - count * intervalSec;

    let prevClose = currentOraclePrice * 0.96;
    for (let i = 0; i < count; i++) {
      const time = start + i * intervalSec;
      const pct = (i / (count - 1));
      // target smoothly towards currentOraclePrice
      const target = currentOraclePrice * 0.96 + (currentOraclePrice - currentOraclePrice * 0.96) * pct;
      const noise = (Math.sin(i * 1.5) * 0.015 + (Math.random() - 0.5) * 0.01) * target;
      const open = i === 0 ? prevClose : prevClose;
      const close = i === count - 1 ? currentOraclePrice : target + noise;
      const high = Math.max(open, close) + Math.abs(noise * 0.5);
      const low = Math.min(open, close) - Math.abs(noise * 0.5);
      candles.push({ time, open, high, low, close });
      prevClose = close;
    }
    return candles;
  }, [currentOraclePrice, granularity]);

  // TradingView Lightweight-Charts integration
  useEffect(() => {
    if (!isClient || !chartContainerRef.current) return;

    let chart: any = null;
    let candleSeries: any = null;
    let resizeObserver: ResizeObserver | null = null;
    let unwatchSwaps: (() => void) | null = null;

    let isMounted = true;

    import('lightweight-charts').then(({ createChart, CandlestickSeries, ColorType, LineStyle }) => {
      if (!isMounted || !chartContainerRef.current) return;

      chartContainerRef.current.innerHTML = '';

      chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#a1a1aa',
          fontSize: 11,
          fontFamily: 'monospace',
        },
        grid: {
          vertLines: { color: 'rgba(39, 39, 42, 0.4)' },
          horzLines: { color: 'rgba(39, 39, 42, 0.4)' },
        },
        crosshair: {
          mode: 1, // CrosshairMode.Normal
        },
        rightPriceScale: {
          borderColor: '#27272a',
          scaleMargins: {
            top: 0.1,
            bottom: 0.2,
          },
        },
        timeScale: {
          borderColor: '#27272a',
          timeVisible: true,
          secondsVisible: false,
        },
        autoSize: true,
      });

      candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      });

      candleSeries.setData(baseCandles);

      // Strike Price Line
      candleSeries.createPriceLine({
        price: entryPrice,
        color: '#f59e0b',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Strike $${entryPrice.toLocaleString()}`,
      });

      // Current Oracle Spot Line
      candleSeries.createPriceLine({
        price: currentOraclePrice,
        color: '#6366f1',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `Spot $${currentOraclePrice.toLocaleString()}`,
      });

      chart.timeScale().fitContent();

      // Subscribe to real-time swaps from PoolManager
      const poolId = '0x' + '00'.repeat(32) as Hex; // default pool stream identifier
      unwatchSwaps = subscribeToPoolSwaps(poolId, (swap) => {
        if (!isMounted || !candleSeries) return;
        // SqrtPriceX96 to float price conversion
        const sqrtPrice = Number(swap.sqrtPriceX96) / 2 ** 96;
        const livePrice = sqrtPrice > 0 ? sqrtPrice * sqrtPrice : currentOraclePrice;
        setLastLivePrice(livePrice);

        const lastCandle = baseCandles[baseCandles.length - 1];
        if (lastCandle) {
          const updatedCandle: CandleData = {
            time: lastCandle.time,
            open: lastCandle.open,
            high: Math.max(lastCandle.high, livePrice),
            low: Math.min(lastCandle.low, livePrice),
            close: livePrice,
          };
          candleSeries.update(updatedCandle);
        }
      });
    });

    return () => {
      isMounted = false;
      if (unwatchSwaps) unwatchSwaps();
      if (chart) {
        chart.remove();
      }
    };
  }, [baseCandles, entryPrice, currentOraclePrice, isClient]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-zinc-100 font-sans shadow-2xl">
      {/* Header Controls */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-wide text-zinc-300">
            elpi.xyz Market Depth & Price
          </span>
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
            v4 Flash Netting Active
          </span>
          <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
            Hook: 0xC8
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1 border border-zinc-800">
          {(['1h', '4h', '1d'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                granularity === g
                  ? 'bg-zinc-700 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Panel 1 — Interactive Lightweight-Charts Canvas (60% Height) */}
      <div className="relative h-72 w-full rounded-lg bg-zinc-900/50 p-2 border border-zinc-800/80 flex flex-col justify-between overflow-hidden">
        {/* Metric Bar */}
        <div className="flex items-center justify-between text-xs text-zinc-400 px-2 pt-1 z-10">
          <div>
            Oracle Spot:{' '}
            <span className="font-mono text-white font-semibold">
              ${currentOraclePrice.toLocaleString()}
            </span>
          </div>
          <div>
            Entry / Strike:{' '}
            <span className="font-mono text-amber-400 font-semibold">
              ${entryPrice.toLocaleString()}
            </span>
          </div>
          <div>
            Expiry Window:{' '}
            <span className="font-mono text-indigo-400 font-semibold">
              +{durationHours}h
            </span>
          </div>
        </div>

        {/* Profit Zone Overlay Tag */}
        <div className="absolute right-4 top-10 pointer-events-none z-10">
          {optionType === 'CALL' ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] text-emerald-400 font-mono uppercase tracking-wider">
              Call ITM &gt; ${entryPrice}
            </div>
          ) : (
            <div className="bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded text-[10px] text-rose-400 font-mono uppercase tracking-wider">
              Put ITM &lt; ${entryPrice}
            </div>
          )}
        </div>

        {/* Canvas DOM Node */}
        <div ref={chartContainerRef} className="w-full h-56 relative z-0" />

        <div className="flex justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/40 px-2 z-10">
          <span>Uniswap v4 Dynamic Fee Pool</span>
          <span className="text-zinc-400 font-mono">0 AMM Fee Waiver Active</span>
          <span className="text-amber-400 font-semibold">Expiry ({durationHours}h)</span>
        </div>
      </div>

      {/* Panel 2 — Market Depth (25% Height) */}
      <div className="rounded-lg bg-zinc-900/40 p-3 border border-zinc-800">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-semibold text-zinc-300">Uniswap v4 Settlement Depth</span>
          <span
            className={`font-mono text-[11px] ${
              isHealthyLiquidity ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            Depth vs Size: {depthRatio.toFixed(0)}% (
            {isHealthyLiquidity ? '🟢 Sufficient' : '🟡 Constrained'})
          </span>
        </div>

        {/* Visual Depth Bar */}
        <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden flex">
          <div
            className="bg-emerald-500 h-full transition-all"
            style={{ width: `${Math.min(depthRatio, 100)}%` }}
          />
        </div>

        {!executable && (
          <div className="mt-2 rounded bg-rose-500/10 p-2 text-xs text-rose-400 border border-rose-500/20">
            ⚠️ <strong>Blocking:</strong> Pool depth is insufficient to clear settlement swap
            at the oracle floor. Minting against this pool is restricted to protect taker payout.
          </div>
        )}
      </div>

      {/* Panel 3 — Volume & Yield (15% Height) */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded bg-zinc-900/60 p-2 border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase">24h Pool Volume</div>
          <div className="font-mono text-zinc-200 font-semibold mt-0.5">$3.42M</div>
        </div>
        <div className="rounded bg-zinc-900/60 p-2 border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase">Est. LP Fee APR</div>
          <div className="font-mono text-emerald-400 font-semibold mt-0.5">6.24%</div>
        </div>
        <div className="rounded bg-zinc-900/60 p-2 border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase">Open Interest</div>
          <div className="font-mono text-zinc-200 font-semibold mt-0.5">42.5 WETH</div>
        </div>
      </div>
    </div>
  );
};
export default MarketChart;
