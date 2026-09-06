// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useMemo } from 'react';
import type { Address, Hex } from 'viem';
import { MarketChart } from '@/components/MarketChart';
import { MintFlow } from '@/components/MintFlow';
import { SettlementFlow } from '@/components/SettlementFlow';
import { OptionsGreeksBar } from '@/components/OptionsGreeksBar';
import { FlashAccountingStream } from '@/components/FlashAccountingStream';
import { estimateOptionPremiumAndGreeks } from '@/lib/premiumEstimation';
import { DYNAMIC_FEE_FLAG } from '@/lib/routeId';
import type { PoolKey } from '@/lib/types';
import {
  simulateOptionMint,
  simulateSettlement,
  CONTRACT_ADDRESSES,
  BASE_CHAIN_ID,
} from '@/lib/client';
import { useOraclePrice } from '@/hooks/useOraclePrice';
import { useWallet } from '@/context/WalletContext';
import { ElpiLogo } from '@/components/ElpiLogo';

export default function TradePage() {
  const [activeTab, setActiveTab] = useState<'mint' | 'settle'>('mint');
  const [optionType, setOptionType] = useState<'CALL' | 'PUT'>('CALL');
  const [positionUnits, setPositionUnits] = useState<number>(1.0);
  const [durationHours, setDurationHours] = useState<number>(24);
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1d'>('1h');

  // Live Oracle Integration
  const {
    spotPrice: currentOraclePrice,
    updatedAt: lastOracleUpdate,
    isStale,
    isWarning,
    refresh: refreshOracle,
  } = useOraclePrice();

  // Strike / Entry Price for active position
  const [entryPrice, setEntryPrice] = useState<number>(3000);

  // Active position details for settlement flow
  const [activePositionId, setActivePositionId] = useState<string>('1247');

  // Wallet context
  const { address, isConnected, refreshBalances } = useWallet();

  // Status notifications
  const [txNotification, setTxNotification] = useState<{
    type: 'mint' | 'settle';
    title: string;
    message: string;
    txHash: string;
  } | null>(null);

  // Real-time Greeks & Implied Volatility calculation from Stitch layout
  const premiumAnalysis = useMemo(() => {
    return estimateOptionPremiumAndGreeks({
      spotPrice: currentOraclePrice,
      strikePrice: entryPrice,
      durationHours,
      units: positionUnits,
      ratePerHour: 0.002,
      optionType,
      impliedVol: 0.64,
    });
  }, [currentOraclePrice, entryPrice, durationHours, positionUnits, optionType]);

  // Canonical WETH/USDC Uniswap v4 PoolKey derived from deployed addresses
  const poolKey: PoolKey = useMemo(() => {
    const weth = CONTRACT_ADDRESSES[BASE_CHAIN_ID].weth;
    const usdc = CONTRACT_ADDRESSES[BASE_CHAIN_ID].usdc;
    const hook = CONTRACT_ADDRESSES[BASE_CHAIN_ID].optionSettlementHook;

    const [c0, c1] =
      weth.toLowerCase() < usdc.toLowerCase() ? [weth, usdc] : [usdc, weth];

    return {
      currency0: c0,
      currency1: c1,
      fee: DYNAMIC_FEE_FLAG,
      tickSpacing: 60,
      hooks: hook,
    };
  }, []);

  const handleConfirmMint = async (routeId: string) => {
    try {
      const res = await simulateOptionMint({
        routeId: routeId as Hex,
        units: positionUnits,
        durationHours,
        oraclePrice: currentOraclePrice,
      });

      setActivePositionId(res.positionId);
      setEntryPrice(currentOraclePrice);
      await refreshBalances();

      setTxNotification({
        type: 'mint',
        title: `Option Agreement #${res.positionId} Minted`,
        message: `Minted ${positionUnits} units bound to route ${res.routeId.slice(0, 10)}... via PositionManager.mint(). Invariants I1 & I2 committed.`,
        txHash: res.txHash,
      });
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleExecuteSettlement = async (minPayout: number, isDirectLp: boolean) => {
    try {
      const gross =
        optionType === 'CALL'
          ? Math.max(0, currentOraclePrice - entryPrice) * positionUnits
          : Math.max(0, entryPrice - currentOraclePrice) * positionUnits;

      const fee = (gross * 100) / 10000;
      const net = gross - fee;

      const res = await simulateSettlement({
        positionId: activePositionId,
        minPayout,
        isDirectLp,
        netPayout: net,
        protocolFee: fee,
      });

      await refreshBalances();

      setTxNotification({
        type: 'settle',
        title: `Position #${activePositionId} Settled`,
        message: `Settled ${isDirectLp ? 'directly with LP (2-of-2)' : 'via ConditionArbiter'}. Taker received ${net.toFixed(2)} USDC with 0 AMM swap fees.`,
        txHash: res.txHash,
      });
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6 font-sans">
      {/* Top Banner & Market Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2D2F3F]/60 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <ElpiLogo size="sm" showBadge={true} badgeText="Uniswap v4" />
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              WETH / USDC Options Terminal
            </h1>
            <span className="text-xs bg-uni-pink-subtle text-uni-pink border border-uni-pink/30 px-2.5 py-0.5 rounded-full font-mono font-bold flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,0,122,0.15)]">
              <span className="h-1.5 w-1.5 rounded-full bg-uni-pink animate-pulse" />
              0 AMM Swap Fee Waiver
            </span>
          </div>
          <p className="text-xs sm:text-sm text-uni-muted mt-1.5 max-w-2xl">
            Fixed agreement options executed over Uniswap v4 flash-accounting with Invariant I1 (isolated collateral) & I4 (fee base protection).
          </p>
        </div>

        {/* Oracle Spot & Quick Stats */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 w-full md:w-auto">
          <div className="text-left sm:text-right bg-[#13141E]/90 border border-[#2D2F3F] px-4 py-2 rounded-2xl shadow-inner">
            <div className="flex items-center justify-start sm:justify-end gap-1.5">
              <span
                className={`text-[10px] uppercase tracking-wider font-bold block ${
                  isStale ? 'text-uni-red' : isWarning ? 'text-uni-amber' : 'text-stitch-tertiary-bright'
                }`}
              >
                {isStale ? '⚠️ Oracle Stale' : isWarning ? '🟡 Oracle Expiring' : '● Oracle Spot'}
              </span>
              <button
                onClick={refreshOracle}
                title="Refresh Oracle Price"
                className="text-[11px] text-uni-muted hover:text-uni-pink transition-colors font-mono cursor-pointer"
              >
                ↻
              </button>
            </div>
            <span className="text-lg sm:text-xl font-mono font-black text-white block mt-0.5">
              ${currentOraclePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex rounded-full bg-[#13141E]/90 p-1 border border-[#2D2F3F] shadow-inner">
            <button
              onClick={() => setOptionType('CALL')}
              className={`px-4 py-2 text-xs font-bold rounded-full transition-all ${
                optionType === 'CALL'
                  ? 'bg-gradient-to-r from-uni-green to-emerald-600 text-white shadow-[0_0_12px_rgba(0,211,149,0.25)]'
                  : 'text-uni-muted hover:text-white'
              }`}
            >
              CALL
            </button>
            <button
              onClick={() => setOptionType('PUT')}
              className={`px-4 py-2 text-xs font-bold rounded-full transition-all ${
                optionType === 'PUT'
                  ? 'bg-gradient-to-r from-uni-red to-rose-600 text-white shadow-[0_0_12px_rgba(255,73,74,0.25)]'
                  : 'text-uni-muted hover:text-white'
              }`}
            >
              PUT
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Notification Banner */}
      {txNotification && (
        <div className="rounded-3xl bg-gradient-to-r from-uni-pink-subtle to-uni-blue-subtle border border-uni-pink/30 p-4.5 flex items-start justify-between gap-4 shadow-uni-pink animate-fade-in">
          <div className="space-y-1">
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-uni-pink shadow-[0_0_8px_#FF007A]" />
              {txNotification.title}
            </div>
            <p className="text-xs text-zinc-200">{txNotification.message}</p>
            <div className="text-[11px] font-mono text-uni-pink break-all pt-0.5 font-semibold">
              Tx: {txNotification.txHash}
            </div>
          </div>
          <button
            onClick={() => setTxNotification(null)}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Grid: Left = Market Chart + Greeks + Stream (65%), Right = Mint / Settlement Flow (35%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Terminal Market Canvas (65% width) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Chart Header Bar with Timeframe Pills */}
          <div className="flex items-center justify-between px-3 py-2 rounded-2xl bg-[#13141E]/90 border border-[#2D2F3F]/80">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-zinc-300">WETH/USDC Price & Depth</span>
              <span className="text-[10px] bg-stitch-tertiary/20 text-stitch-tertiary-bright px-2 py-0.5 rounded-full font-mono font-bold">
                LIVE
              </span>
            </div>
            {/* Timeframe selector chips from Stitch */}
            <div className="flex items-center gap-1 bg-[#0D0E15] p-1 rounded-xl border border-white/5 font-mono text-[11px]">
              {(['1m', '5m', '15m', '1h', '4h', '1d'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2 py-0.5 rounded-lg transition-all ${
                    timeframe === tf
                      ? 'bg-white/15 text-white font-bold'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Market Depth & Price Chart */}
          <MarketChart
            poolKey={poolKey}
            entryPrice={entryPrice}
            currentOraclePrice={currentOraclePrice}
            durationHours={durationHours}
            optionType={optionType}
            positionSize={positionUnits}
            slippageBps={100}
            executable={true}
          />

          {/* Real-time Options Greeks Bar from Stitch */}
          <OptionsGreeksBar
            greeks={premiumAnalysis.greeks}
            impliedVol={premiumAnalysis.impliedVolAnnual}
            efficiency={premiumAnalysis.efficiency}
          />

          {/* Uniswap v4 Flash-Accounting Terminal Feed from Stitch */}
          <FlashAccountingStream />
        </div>

        {/* Right: Trade Interaction & Execution Rail (35% width) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Tab Switcher */}
          <div className="flex rounded-full bg-[#13141E]/90 p-1.5 border border-[#2D2F3F] shadow-inner">
            <button
              onClick={() => setActiveTab('mint')}
              className={`flex-1 py-2 text-xs font-bold rounded-full transition-all ${
                activeTab === 'mint'
                  ? 'bg-gradient-to-r from-uni-pink to-uni-purple text-white shadow-uni-pink'
                  : 'text-uni-muted hover:text-white'
              }`}
            >
              Mint New Option
            </button>
            <button
              onClick={() => setActiveTab('settle')}
              className={`flex-1 py-2 text-xs font-bold rounded-full transition-all ${
                activeTab === 'settle'
                  ? 'bg-gradient-to-r from-uni-pink to-uni-purple text-white shadow-uni-pink'
                  : 'text-uni-muted hover:text-white'
              }`}
            >
              Settlement & Payout
            </button>
          </div>

          {/* Tab Contents */}
          {activeTab === 'mint' ? (
            <MintFlow
              poolKey={poolKey}
              tokenSymbol="WETH"
              settlementSymbol="USDC"
              oraclePrice={currentOraclePrice}
              optionType={optionType}
              onOptionTypeChange={setOptionType}
              onConfirmMint={handleConfirmMint}
            />
          ) : (
            <SettlementFlow
              positionId={activePositionId}
              optionType={optionType}
              entryPrice={entryPrice}
              currentOraclePrice={currentOraclePrice}
              maxPriceAgeSeconds={3600}
              lastOracleUpdateTimestamp={lastOracleUpdate}
              units={positionUnits}
              scalar={1}
              feeBps={100} // 1%
              settlementSymbol="USDC"
              onExecuteSettlement={handleExecuteSettlement}
            />
          )}
        </div>
      </div>
    </div>
  );
}
