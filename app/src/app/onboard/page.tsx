// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { isAddress, getAddress } from 'viem';
import { computeRouteId, DYNAMIC_FEE_FLAG } from '@/lib/routeId';
import { verifySettlementLiquidity } from '@/lib/routeVerification';
import type { PoolKey, LiquidityCheckResult } from '@/lib/types';
import type { CcaApiResponse } from '@/app/api/cca/[auctionId]/route';
import { CONTRACT_ADDRESSES, BASE_CHAIN_ID } from '@/lib/client';

export default function AssetOnboardingWizard() {
  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3 | 4>(0);

  // ─── Step 0: Prerequisites ────────────────────────────────────────────────
  const defaultTokens = CONTRACT_ADDRESSES[BASE_CHAIN_ID];
  const [tokenAddress, setTokenAddress] = useState<string>(defaultTokens.weth);
  const [tokenSymbol, setTokenSymbol] = useState<string>('WETH');
  const [oracleFeedAddress, setOracleFeedAddress] = useState<string>(defaultTokens.chainlinkEthUsd);
  const [cadenceHintSeconds, setCadenceHintSeconds] = useState<number>(3600); // 1h
  const [settlementAsset, setSettlementAsset] = useState<string>(defaultTokens.usdc); // USDC
  const [prereqsVerified, setPrereqsVerified] = useState<boolean>(false);
  const [prereqError, setPrereqError] = useState<string | null>(null);

  // ─── Step 1: CCA Parameters ───────────────────────────────────────────────
  const [auctionDurationHours, setAuctionDurationHours] = useState<number>(2); // >= 1h
  const [minPrice, setMinPrice] = useState<number>(1800);
  const [maxPrice, setMaxPrice] = useState<number>(2400);
  const [autoSeedV4Hook, setAutoSeedV4Hook] = useState<boolean>(true);
  const [auctionId, setAuctionId] = useState<string>('');

  // ─── Step 2: Auction Monitor ──────────────────────────────────────────────
  const [ccaData, setCcaData] = useState<CcaApiResponse | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [pollError, setPollError] = useState<string | null>(null);

  // ─── Step 3: Pool Seeding ─────────────────────────────────────────────────
  const [seededPoolKey, setSeededPoolKey] = useState<PoolKey | null>(null);
  const [seededRouteId, setSeededRouteId] = useState<string | null>(null);
  const [routeRegistered, setRouteRegistered] = useState<boolean>(false);

  // ─── Step 4: Liquidity Profile ────────────────────────────────────────────
  const [profileUnits, setProfileUnits] = useState<number>(10);
  const [ratePerHour, setRatePerHour] = useState<number>(0.002);
  const [minHours, setMinHours] = useState<number>(4);
  const [maxHours, setMaxHours] = useState<number>(168);
  const [liquidityCheck, setLiquidityCheck] = useState<LiquidityCheckResult | null>(null);
  const [isCheckingLiquidity, setIsCheckingLiquidity] = useState<boolean>(false);
  const [profilePublished, setProfilePublished] = useState<boolean>(false);

  // ─── Step 0 Validation ────────────────────────────────────────────────────
  const handleVerifyPrerequisites = () => {
    setPrereqError(null);
    if (!isAddress(tokenAddress)) {
      setPrereqError('Invalid ERC-20 token address.');
      return;
    }
    if (!isAddress(oracleFeedAddress)) {
      setPrereqError('Invalid Chainlink oracle feed address.');
      return;
    }
    if (!isAddress(settlementAsset)) {
      setPrereqError('Invalid settlement asset address.');
      return;
    }
    if (cadenceHintSeconds <= 0 || cadenceHintSeconds > 86400) {
      setPrereqError('Oracle cadenceHint must be between 1 and 86,400 seconds (measured real round history).');
      return;
    }

    setPrereqsVerified(true);
  };

  // ─── Step 1 Launch CCA ────────────────────────────────────────────────────
  const handleLaunchAuction = () => {
    const newAuctionId = `cca-${tokenSymbol.toLowerCase()}-${Date.now().toString().slice(-6)}`;
    setAuctionId(newAuctionId);
    setActiveStep(2);
  };

  // ─── Step 2 Poll CCA API ──────────────────────────────────────────────────
  useEffect(() => {
    if (activeStep !== 2 || !auctionId) return;

    let timer: NodeJS.Timeout;
    const fetchStatus = async () => {
      try {
        setIsPolling(true);
        const res = await fetch(`/api/cca/${auctionId}`);
        if (!res.ok) throw new Error(`Status HTTP ${res.status}`);
        const data: CcaApiResponse = await res.json();
        setCcaData(data);

        // Derive pool when closed or seeded
        if (data.status === 'CLOSED' || data.status === 'SEEDED') {
          const t0 = getAddress(tokenAddress);
          const t1 = getAddress(settlementAsset);
          const [c0, c1] = t0.toLowerCase() < t1.toLowerCase() ? [t0, t1] : [t1, t0];
          const hook = CONTRACT_ADDRESSES[BASE_CHAIN_ID].optionSettlementHook;
          const key: PoolKey = {
            currency0: c0,
            currency1: c1,
            fee: DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook,
          };
          setSeededPoolKey(key);
          setSeededRouteId(computeRouteId(key));
        }
      } catch (err: any) {
        setPollError(err?.message || 'Failed to poll CCA status');
      } finally {
        setIsPolling(false);
      }
    };

    fetchStatus();
    timer = setInterval(fetchStatus, 4000);
    return () => clearInterval(timer);
  }, [activeStep, auctionId, tokenAddress, settlementAsset]);

  // Fast-forward auction simulation
  const handleFastForward = async () => {
    try {
      const res = await fetch(`/api/cca/${auctionId}?state=CLOSED`);
      const data: CcaApiResponse = await res.json();
      setCcaData(data);
      const t0 = getAddress(tokenAddress);
      const t1 = getAddress(settlementAsset);
      const [c0, c1] = t0.toLowerCase() < t1.toLowerCase() ? [t0, t1] : [t1, t0];
      const hook = CONTRACT_ADDRESSES[BASE_CHAIN_ID].optionSettlementHook;
      const key: PoolKey = {
        currency0: c0,
        currency1: c1,
        fee: DYNAMIC_FEE_FLAG,
        tickSpacing: 60,
        hooks: hook,
      };
      setSeededPoolKey(key);
      setSeededRouteId(computeRouteId(key));
    } catch (e) {
      console.error(e);
    }
  };

  // ─── Step 4 Pre-trade Liquidity Verification ──────────────────────────────
  useEffect(() => {
    if (activeStep !== 4 || !seededPoolKey) return;

    const checkLiquidity = async () => {
      setIsCheckingLiquidity(true);
      try {
        const result = await verifySettlementLiquidity({
          tokenIn: seededPoolKey.currency0,
          tokenOut: seededPoolKey.currency1,
          amountIn: BigInt(profileUnits) * 10n ** 18n,
          oracleFloor: 2040000000n, // $2040 min payout floor
          slippageBps: 100, // 1%
          poolKey: seededPoolKey,
        });
        setLiquidityCheck(result);
      } catch (e) {
        console.error(e);
      } finally {
        setIsCheckingLiquidity(false);
      }
    };

    checkLiquidity();
  }, [activeStep, profileUnits, seededPoolKey]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-10 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-zinc-800 pb-6">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono uppercase bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded border border-indigo-500/20">
              elpi.xyz Asset Onboarding
            </span>
            <span className="text-xs text-zinc-400 font-mono">Milestone UV4</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mt-2">
            Continuous Clearing Auction & Asset Pipeline
          </h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
            Bootstrap fair pricing, seed canonical Uniswap v4 settlement pools, and gate LP profiles
            with off-chain QuoterV2 depth verification (§5, §6).
          </p>
        </div>

        {/* Step Progress Navigation */}
        <div className="grid grid-cols-5 gap-2 text-xs font-medium text-center">
          {[
            { step: 0, label: '0. Prerequisites' },
            { step: 1, label: '1. CCA Setup' },
            { step: 2, label: '2. Auction Monitor' },
            { step: 3, label: '3. Pool Seeding' },
            { step: 4, label: '4. LP Profile' },
          ].map((item) => (
            <button
              key={item.step}
              onClick={() => {
                if (item.step <= activeStep || (item.step === 1 && prereqsVerified)) {
                  setActiveStep(item.step as any);
                }
              }}
              className={`p-2.5 rounded-lg border transition-all ${
                activeStep === item.step
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300 shadow-md font-semibold'
                  : item.step < activeStep
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                  : 'border-zinc-800 bg-zinc-900/40 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* ─── Step 0: Prerequisites ─────────────────────────────────────── */}
        {activeStep === 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-6 shadow-xl">
            <div>
              <h2 className="text-lg font-bold text-white">Step 0 — Prerequisite Verification</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Verify target ERC-20 token and Chainlink oracle feed parameters before launching auction (§5.2).
              </p>
            </div>

            {prereqError && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
                {prereqError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-400 font-semibold uppercase">Token Address (Base)</label>
                <input
                  type="text"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value.trim())}
                  className="w-full mt-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 font-semibold uppercase">Token Symbol</label>
                <input
                  type="text"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value.trim())}
                  className="w-full mt-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 font-semibold uppercase">Chainlink Feed Address</label>
                <input
                  type="text"
                  value={oracleFeedAddress}
                  onChange={(e) => setOracleFeedAddress(e.target.value.trim())}
                  className="w-full mt-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 font-semibold uppercase">Cadence Hint (Seconds)</label>
                <input
                  type="number"
                  value={cadenceHintSeconds}
                  onChange={(e) => setCadenceHintSeconds(parseInt(e.target.value) || 0)}
                  className="w-full mt-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Q13 Rule: Must be measured from real round history (never guessed).
                </span>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-zinc-400 font-semibold uppercase">Settlement Asset</label>
                <input
                  type="text"
                  value={settlementAsset}
                  onChange={(e) => setSettlementAsset(e.target.value.trim())}
                  className="w-full mt-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Canonical Base USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
              <span className="text-xs text-zinc-400">
                {prereqsVerified ? (
                  <span className="text-emerald-400 font-medium">✓ Prerequisites validated</span>
                ) : (
                  'Ready to validate'
                )}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleVerifyPrerequisites}
                  className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-xs font-medium transition-colors"
                >
                  Verify Prerequisites
                </button>
                {prereqsVerified && (
                  <button
                    onClick={() => setActiveStep(1)}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition-colors"
                  >
                    Proceed to CCA Setup →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 1: CCA Setup ─────────────────────────────────────────── */}
        {activeStep === 1 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-6 shadow-xl">
            <div>
              <h2 className="text-lg font-bold text-white">Step 1 — Configure Continuous Clearing Auction</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Uniform price batch auction prevents sniping and bootstraps initial settlement liquidity.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-400 font-semibold uppercase">
                  Auction Duration: {auctionDurationHours} Hours
                </label>
                <input
                  type="range"
                  min="1"
                  max="24"
                  value={auctionDurationHours}
                  onChange={(e) => setAuctionDurationHours(parseInt(e.target.value))}
                  className="w-full mt-2 accent-indigo-500"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Recommended: ≥1 hour to ensure multi-block uniform clearing.
                </span>
              </div>

              <div>
                <label className="text-xs text-zinc-400 font-semibold uppercase">Price Bounds (USDC)</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input
                    type="number"
                    value={minPrice}
                    onChange={(e) => setMinPrice(parseFloat(e.target.value) || 0)}
                    placeholder="Min"
                    className="w-1/2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                  />
                  <span className="text-zinc-500">to</span>
                  <input
                    type="number"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(parseFloat(e.target.value) || 0)}
                    placeholder="Max"
                    className="w-1/2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-zinc-950/70 p-4 border border-zinc-800/80 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoSeedHook"
                  checked={autoSeedV4Hook}
                  onChange={(e) => setAutoSeedV4Hook(e.target.checked)}
                  className="rounded accent-indigo-500"
                />
                <label htmlFor="autoSeedHook" className="text-xs text-zinc-200 font-semibold cursor-pointer">
                  Auto-seed Uniswap v4 pool with OptionSettlementHook attached
                </label>
              </div>
              <p className="text-xs text-zinc-400 pl-5">
                Proceeds at uniform clearing price seed the canonical v4 pool (fee: 0x800000). The
                OptionSettlementHook enables 0-fee settlement waivers for option payouts (Invariant I4).
              </p>
            </div>

            <div className="flex justify-between pt-2 border-t border-zinc-800">
              <button
                onClick={() => setActiveStep(0)}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300"
              >
                ← Back to Prerequisites
              </button>
              <button
                onClick={handleLaunchAuction}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-medium text-white shadow-lg transition-colors"
              >
                Launch CCA Auction →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Auction Monitor ───────────────────────────────────── */}
        {activeStep === 2 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Step 2 — Continuous Clearing Auction Monitor</h2>
                <span className="text-xs font-mono text-zinc-400">Auction ID: {auctionId}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
                </span>
                <span className="text-xs font-mono text-indigo-300">
                  {ccaData?.status || 'POLLING'}
                </span>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-zinc-950/70 p-3 border border-zinc-800">
                <span className="text-[11px] text-zinc-500 uppercase">Status</span>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {ccaData?.status || 'CONNECTING'}
                </div>
              </div>
              <div className="rounded-xl bg-zinc-950/70 p-3 border border-zinc-800">
                <span className="text-[11px] text-zinc-500 uppercase">Estimated Clearing</span>
                <div className="text-sm font-bold font-mono text-emerald-400 mt-1">
                  {ccaData?.clearingPriceFormatted || '$2,048.00 USDC'}
                </div>
              </div>
              <div className="rounded-xl bg-zinc-950/70 p-3 border border-zinc-800">
                <span className="text-[11px] text-zinc-500 uppercase">Orders Cleared</span>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {ccaData?.totalOrders ?? 84} orders
                </div>
              </div>
              <div className="rounded-xl bg-zinc-950/70 p-3 border border-zinc-800">
                <span className="text-[11px] text-zinc-500 uppercase">Anti-Sniping</span>
                <div className="text-sm font-bold font-mono text-indigo-400 mt-1">Active (Cancun)</div>
              </div>
            </div>

            <div className="rounded-xl bg-zinc-950/50 p-4 border border-zinc-800/80 space-y-2">
              <div className="text-xs text-zinc-300 font-semibold">Uniform-Price Batch Progress</div>
              <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: ccaData?.status === 'CLOSED' ? '100%' : '65%' }}
                ></div>
              </div>
              <div className="flex justify-between text-[11px] text-zinc-500 font-mono">
                <span>Start: {tokenSymbol}/USDC</span>
                <span>{ccaData?.status === 'CLOSED' ? 'Auction Closed' : 'Clearing in progress...'}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
              <button
                onClick={handleFastForward}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors"
              >
                Fast-forward to Close (Simulate)
              </button>
              <button
                onClick={() => setActiveStep(3)}
                disabled={ccaData?.status !== 'CLOSED' && ccaData?.status !== 'SEEDED'}
                className="rounded-lg bg-indigo-600 disabled:bg-zinc-800 disabled:text-zinc-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition-colors"
              >
                Proceed to Pool Seeding →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Pool Seeding Confirmation ─────────────────────────── */}
        {activeStep === 3 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-6 shadow-xl">
            <div>
              <h2 className="text-lg font-bold text-white">Step 3 — Canonical Pool Seeding & Route Registration</h2>
              <p className="text-xs text-zinc-400 mt-1">
                CCA proceeds seeded the v4 pool at uniform clearing price. Register routeId in UniswapV4VenueAdapter (§3.3).
              </p>
            </div>

            {seededPoolKey && (
              <div className="rounded-xl bg-zinc-950/70 p-4 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Clearing Reference Price:</span>
                  <span className="font-mono text-emerald-400 font-bold">$2,048.00 USDC</span>
                </div>
                <div className="text-xs space-y-1 font-mono text-zinc-300">
                  <div>currency0: {seededPoolKey.currency0}</div>
                  <div>currency1: {seededPoolKey.currency1}</div>
                  <div>fee: 0x800000 (DYNAMIC_FEE_FLAG)</div>
                  <div>hooks: {seededPoolKey.hooks}</div>
                </div>
                <div className="border-t border-zinc-800/80 pt-2 text-xs">
                  <span className="text-zinc-500 uppercase font-semibold text-[10px]">Derived Route ID (Invariant I2):</span>
                  <div className="font-mono text-indigo-300 break-all mt-0.5">{seededRouteId}</div>
                </div>
              </div>
            )}

            <div className="rounded-xl bg-indigo-500/5 p-4 border border-indigo-500/20 space-y-2">
              <div className="text-xs text-indigo-300 font-semibold">Adapter Registration Calldata</div>
              <p className="text-xs text-zinc-400">
                Calling <code>UniswapV4VenueAdapter.registerRoute(poolKey, "")</code> binds this pool for all
                subsequent option settlements. This is append-only and strictly irreversible (Invariant I2).
              </p>
            </div>

            <div className="flex justify-between pt-2 border-t border-zinc-800">
              <button
                onClick={() => setActiveStep(2)}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-xs text-zinc-300"
              >
                ← Back to Auction Monitor
              </button>
              <button
                onClick={() => {
                  setRouteRegistered(true);
                  setActiveStep(4);
                }}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-5 py-2 text-xs font-medium text-white shadow-lg transition-colors"
              >
                Confirm Route & Proceed to LP Profile →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 4: Liquidity Profile Creation ─────────────────────────── */}
        {activeStep === 4 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-6 shadow-xl">
            <div>
              <h2 className="text-lg font-bold text-white">Step 4 — LP Profile Creation & Liquidity Gating</h2>
              <p className="text-xs text-zinc-400 mt-1">
                OptionCore requires pre-trade liquidity verification via QuoterV2 (§6.1) before any LP profile is published.
              </p>
            </div>

            {/* Profile Config */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-zinc-400">Max Units (ETH)</label>
                <input
                  type="number"
                  value={profileUnits}
                  onChange={(e) => setProfileUnits(parseFloat(e.target.value) || 1)}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Rate / Unit / Hour</label>
                <input
                  type="number"
                  value={ratePerHour}
                  step="0.0005"
                  onChange={(e) => setRatePerHour(parseFloat(e.target.value) || 0.001)}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Min Duration (h)</label>
                <input
                  type="number"
                  value={minHours}
                  onChange={(e) => setMinHours(parseInt(e.target.value) || 1)}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Max Duration (h)</label>
                <input
                  type="number"
                  value={maxHours}
                  onChange={(e) => setMaxHours(parseInt(e.target.value) || 24)}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                />
              </div>
            </div>

            {/* Live Pre-Trade Liquidity Check Results (§6.1) */}
            <div className="rounded-xl bg-zinc-950/70 p-4 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 font-semibold uppercase">
                  QuoterV2 Pre-Trade Liquidity Verification
                </span>
                {isCheckingLiquidity ? (
                  <span className="text-xs font-mono text-zinc-500 animate-pulse">Simulating...</span>
                ) : liquidityCheck?.executable ? (
                  <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono font-medium">
                    🟢 Executable at Oracle Floor
                  </span>
                ) : (
                  <span className="text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded font-mono font-medium">
                    🔴 Insufficient Pool Depth
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>Price Impact: {liquidityCheck ? `${liquidityCheck.priceImpactBps / 100}%` : '0%'}</div>
                <div>Expected Output: {liquidityCheck ? `${liquidityCheck.expectedOutput.toString()} units` : '0'}</div>
              </div>

              {liquidityCheck?.warning && (
                <div className="text-xs text-amber-400 bg-amber-500/10 p-2.5 rounded border border-amber-500/20">
                  ⚠ {liquidityCheck.warning}
                </div>
              )}
            </div>

            {profilePublished && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-xs text-emerald-300 space-y-1">
                <div className="font-bold text-white">✓ Liquidity Profile Successfully Published to elpi.xyz</div>
                <div>Asset {tokenSymbol} is now tradeable on Base with verified 0-fee settlement hook.</div>
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-zinc-800">
              <button
                onClick={() => setActiveStep(3)}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-xs text-zinc-300"
              >
                ← Back to Pool Seeding
              </button>
              <button
                onClick={() => setProfilePublished(true)}
                disabled={!liquidityCheck?.executable || profilePublished}
                className="rounded-lg bg-indigo-600 disabled:bg-zinc-800 disabled:text-zinc-600 hover:bg-indigo-500 px-5 py-2 text-xs font-medium text-white shadow-lg transition-colors"
              >
                {profilePublished ? 'Profile Live' : 'Publish Liquidity Profile'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
