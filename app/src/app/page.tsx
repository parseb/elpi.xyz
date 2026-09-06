// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useMemo } from 'react';
import type { Address, Hex } from 'viem';
import { MarketChart } from '@/components/MarketChart';
import { MintFlow } from '@/components/MintFlow';
import { SettlementFlow } from '@/components/SettlementFlow';
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

export default function TradePage() {
  const [activeTab, setActiveTab] = useState<'mint' | 'settle'>('mint');
  const [optionType, setOptionType] = useState<'CALL' | 'PUT'>('CALL');
  const [positionUnits, setPositionUnits] = useState<number>(1.0);
  const [durationHours, setDurationHours] = useState<number>(24);

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
        title: `Option Position #${res.positionId} Minted`,
        message: `Successfully minted ${positionUnits} units bound to route ${res.routeId.slice(0, 10)}... via PositionManager.mint().`,
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
        message: `Settled ${isDirectLp ? 'directly with LP (2-of-2)' : 'via ConditionArbiter'}. Taker received ${net.toFixed(2)} USDC net of 1% protocol fee.`,
        txHash: res.txHash,
      });
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-8 font-sans">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-white">WETH / USDC Option Market</h1>
            <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
              0 AMM Swap Fee Active
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Fixed agreement options executed over Uniswap v4 flash-accounting with Invariant I1 (isolated collateral) & I4 (1% fee protection).
          </p>
        </div>

        {/* Option Type Selector & Oracle Spot */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5">
              <span
                className={`text-[10px] uppercase tracking-wider font-semibold block ${
                  isStale ? 'text-rose-400' : isWarning ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {isStale ? '⚠️ Oracle Stale' : isWarning ? '🟡 Oracle Expiring' : '● Oracle Spot'}
              </span>
              <button
                onClick={refreshOracle}
                title="Refresh Oracle Price"
                className="text-[11px] text-zinc-400 hover:text-indigo-400 transition-colors font-mono cursor-pointer"
              >
                ↻
              </button>
            </div>
            <span className="text-lg font-mono font-bold text-white">
              ${currentOraclePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex rounded-lg bg-zinc-900 p-1 border border-zinc-800">
            <button
              onClick={() => setOptionType('CALL')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                optionType === 'CALL'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              CALL
            </button>
            <button
              onClick={() => setOptionType('PUT')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                optionType === 'PUT'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              PUT
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Notification Banner */}
      {txNotification && (
        <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/30 p-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-400"></span>
              {txNotification.title}
            </div>
            <p className="text-xs text-indigo-200">{txNotification.message}</p>
            <div className="text-[11px] font-mono text-indigo-400/80 break-all">
              Tx: {txNotification.txHash}
            </div>
          </div>
          <button
            onClick={() => setTxNotification(null)}
            className="text-xs text-indigo-300 hover:text-white font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid: Left = Market Chart (60%), Right = Mint / Settlement Flow (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Market Depth & Price Chart */}
        <div className="lg:col-span-7 space-y-4">
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
        </div>

        {/* Trade Interaction Panel */}
        <div className="lg:col-span-5 space-y-4">
          {/* Tab Switcher */}
          <div className="flex rounded-xl bg-zinc-900 p-1 border border-zinc-800">
            <button
              onClick={() => setActiveTab('mint')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'mint'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Mint New Option
            </button>
            <button
              onClick={() => setActiveTab('settle')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'settle'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
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
