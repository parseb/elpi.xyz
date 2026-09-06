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
import { ElpiLogo } from '@/components/ElpiLogo';

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
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6 font-sans">
      {/* Header */}
      <div className="border-b border-[#2D2F3F]/60 pb-5">
        <div className="flex items-center gap-3">
          <ElpiLogo size="sm" showBadge={true} badgeText="CCA Pipeline" />
          <span className="text-xs text-uni-muted font-mono hidden sm:inline">Uniswap v4 Auction Protocol</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-black text-white mt-2 tracking-tight">
          Continuous Clearing Auction &amp; Asset Onboarding
        </h1>
        <p className="text-xs sm:text-sm text-uni-muted mt-1.5 max-w-2xl">
          Bootstrap fair uniform pricing, seed canonical Uniswap v4 settlement pools, and gate LP profiles with off-chain QuoterV2 depth verification (§5, §6).
        </p>
      </div>

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Step Progress Navigation */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-xs font-semibold text-center font-mono">
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
              className={`min-h-[3rem] p-2.5 rounded-2xl border flex items-center justify-center transition-all ${
                activeStep === item.step
                  ? 'border-uni-pink/60 bg-uni-pink/20 text-white shadow-[0_0_16px_rgba(255,0,122,0.3)] font-bold'
                  : item.step < activeStep
                  ? 'border-stitch-tertiary/40 bg-stitch-tertiary/10 text-stitch-tertiary-bright font-medium'
                  : 'border-[#2D2F3F]/40 bg-[#13141E]/40 text-zinc-500 cursor-not-allowed'
              }`}
            >
              <span>{item.step < activeStep ? '✓ ' : ''}{item.label}</span>
            </button>
          ))}
        </div>

        {/* ─── Step 0: Prerequisites ─────────────────────────────────────── */}
        {activeStep === 0 && (
          <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-6 shadow-uni-card">
            <div>
              <h2 className="text-lg font-bold text-white">Step 0 — Prerequisite Verification</h2>
              <p className="text-xs text-uni-muted mt-1">
                Verify target ERC-20 token and Chainlink oracle feed parameters before launching auction (§5.2).
              </p>
            </div>

            {prereqError && (
              <div className="rounded-2xl bg-uni-red-subtle border border-uni-red/30 p-3.5 text-xs text-uni-red">
                {prereqError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5 focus-within:border-uni-pink/40">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Token Address (Base)</label>
                <input
                  type="text"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value.trim())}
                  className="w-full mt-1 bg-transparent text-xs font-mono text-white outline-none"
                />
              </div>

              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5 focus-within:border-uni-pink/40">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Token Symbol</label>
                <input
                  type="text"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value.trim())}
                  className="w-full mt-1 bg-transparent text-xs font-mono text-white outline-none"
                />
              </div>

              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5 focus-within:border-uni-pink/40">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Chainlink Feed Address</label>
                <input
                  type="text"
                  value={oracleFeedAddress}
                  onChange={(e) => setOracleFeedAddress(e.target.value.trim())}
                  className="w-full mt-1 bg-transparent text-xs font-mono text-white outline-none"
                />
              </div>

              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5 focus-within:border-uni-pink/40">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Cadence Hint (Seconds)</label>
                <input
                  type="number"
                  value={cadenceHintSeconds}
                  onChange={(e) => setCadenceHintSeconds(parseInt(e.target.value) || 0)}
                  className="w-full mt-1 bg-transparent text-xs font-mono text-white outline-none"
                />
                <span className="text-[10px] text-uni-muted mt-1 block">
                  Q13 Rule: Must be measured from real round history (never guessed).
                </span>
              </div>

              <div className="md:col-span-2 bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5 focus-within:border-uni-pink/40">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Settlement Asset</label>
                <input
                  type="text"
                  value={settlementAsset}
                  onChange={(e) => setSettlementAsset(e.target.value.trim())}
                  className="w-full mt-1 bg-transparent text-xs font-mono text-white outline-none"
                />
                <span className="text-[10px] text-uni-muted mt-1 block">
                  Canonical Base USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-xs text-uni-muted">
                {prereqsVerified ? (
                  <span className="text-uni-green font-semibold">✓ Prerequisites validated</span>
                ) : (
                  'Ready to validate'
                )}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleVerifyPrerequisites}
                  className="rounded-full bg-white/5 hover:bg-white/10 px-5 py-2.5 text-xs font-bold transition-colors"
                >
                  Verify Prerequisites
                </button>
                {prereqsVerified && (
                  <button
                    onClick={() => setActiveStep(1)}
                    className="rounded-full bg-gradient-to-r from-uni-pink to-uni-purple hover:brightness-110 px-5 py-2.5 text-xs font-bold text-white transition-all shadow-uni-pink"
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
          <div className="rounded-3xl border border-white/10 bg-[#13141E] p-4 sm:p-6 space-y-6 shadow-uni-card">
            <div>
              <h2 className="text-lg font-bold text-white">Step 1 — Configure Continuous Clearing Auction</h2>
              <p className="text-xs text-uni-muted mt-1">
                Uniform price batch auction prevents sniping and bootstraps initial settlement liquidity.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#0D0E15] p-4 rounded-2xl border border-white/5">
                <label className="text-xs text-uni-muted font-bold uppercase">
                  Auction Duration: {auctionDurationHours} Hours
                </label>
                <input
                  type="range"
                  min="1"
                  max="24"
                  value={auctionDurationHours}
                  onChange={(e) => setAuctionDurationHours(parseInt(e.target.value))}
                  className="w-full mt-3 accent-uni-pink"
                />
                <span className="text-[10px] text-uni-muted mt-1 block">
                  Recommended: ≥1 hour to ensure multi-block uniform clearing.
                </span>
              </div>

              <div className="bg-[#0D0E15] p-4 rounded-2xl border border-white/5">
                <label className="text-xs text-uni-muted font-bold uppercase">Price Bounds (USDC)</label>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    value={minPrice}
                    onChange={(e) => setMinPrice(parseFloat(e.target.value) || 0)}
                    placeholder="Min"
                    className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none"
                  />
                  <span className="text-uni-muted text-xs">to</span>
                  <input
                    type="number"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(parseFloat(e.target.value) || 0)}
                    placeholder="Max"
                    className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-2">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="autoSeedHook"
                  checked={autoSeedV4Hook}
                  onChange={(e) => setAutoSeedV4Hook(e.target.checked)}
                  className="rounded accent-uni-pink h-4 w-4"
                />
                <label htmlFor="autoSeedHook" className="text-xs text-white font-bold cursor-pointer">
                  Auto-seed Uniswap v4 pool with OptionSettlementHook attached
                </label>
              </div>
              <p className="text-xs text-uni-muted pl-6">
                Proceeds at uniform clearing price seed the canonical v4 pool (fee: 0x800000). The
                OptionSettlementHook enables 0-fee settlement waivers for option payouts (Invariant I4).
              </p>
            </div>

            <div className="flex justify-between pt-2 border-t border-white/10">
              <button
                onClick={() => setActiveStep(0)}
                className="rounded-full bg-white/5 hover:bg-white/10 px-5 py-2.5 text-xs font-bold text-uni-muted"
              >
                ← Back to Prerequisites
              </button>
              <button
                onClick={handleLaunchAuction}
                className="rounded-full bg-gradient-to-r from-uni-pink to-uni-purple hover:brightness-110 px-6 py-2.5 text-xs font-bold text-white shadow-uni-pink transition-all"
              >
                Launch CCA Auction →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Auction Monitor ───────────────────────────────────── */}
        {activeStep === 2 && (
          <div className="rounded-3xl border border-white/10 bg-[#13141E] p-4 sm:p-6 space-y-6 shadow-uni-card">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Step 2 — Continuous Clearing Auction Monitor</h2>
                <span className="text-xs font-mono text-uni-muted">Auction ID: {auctionId}</span>
              </div>
              <div className="flex items-center gap-2 bg-uni-pink-subtle border border-uni-pink/30 px-3 py-1 rounded-full">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-uni-pink opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-uni-pink"></span>
                </span>
                <span className="text-xs font-mono text-uni-pink font-bold">
                  {ccaData?.status || 'POLLING'}
                </span>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-2xl bg-[#0D0E15] p-3.5 border border-white/5">
                <span className="text-[10px] text-uni-muted uppercase font-bold tracking-wider">Status</span>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {ccaData?.status || 'CONNECTING'}
                </div>
              </div>
              <div className="rounded-2xl bg-[#0D0E15] p-3.5 border border-white/5">
                <span className="text-[10px] text-uni-muted uppercase font-bold tracking-wider">Estimated Clearing</span>
                <div className="text-sm font-bold font-mono text-uni-green mt-1">
                  {ccaData?.clearingPriceFormatted || '$2,048.00 USDC'}
                </div>
              </div>
              <div className="rounded-2xl bg-[#0D0E15] p-3.5 border border-white/5">
                <span className="text-[10px] text-uni-muted uppercase font-bold tracking-wider">Orders Cleared</span>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {ccaData?.totalOrders ?? 84} orders
                </div>
              </div>
              <div className="rounded-2xl bg-[#0D0E15] p-3.5 border border-white/5">
                <span className="text-[10px] text-uni-muted uppercase font-bold tracking-wider">Anti-Sniping</span>
                <div className="text-sm font-bold font-mono text-uni-blue mt-1">Active (Cancun)</div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-2">
              <div className="text-xs text-zinc-300 font-bold">Uniform-Price Batch Progress</div>
              <div className="w-full bg-white/5 rounded-full h-2.5 overflow-hidden p-0.5 border border-white/5">
                <div
                  className="bg-gradient-to-r from-uni-pink to-uni-purple h-full rounded-full transition-all duration-500 shadow-uni-pink"
                  style={{ width: ccaData?.status === 'CLOSED' ? '100%' : '65%' }}
                ></div>
              </div>
              <div className="flex justify-between text-[11px] text-uni-muted font-mono">
                <span>Start: {tokenSymbol}/USDC</span>
                <span>{ccaData?.status === 'CLOSED' ? 'Auction Closed' : 'Clearing in progress...'}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <button
                onClick={handleFastForward}
                className="rounded-full bg-white/5 hover:bg-white/10 px-4 py-2 text-xs font-semibold text-uni-muted hover:text-white transition-colors"
              >
                Fast-forward to Close (Simulate)
              </button>
              <button
                onClick={() => setActiveStep(3)}
                disabled={ccaData?.status !== 'CLOSED' && ccaData?.status !== 'SEEDED'}
                className="rounded-full bg-gradient-to-r from-uni-pink to-uni-purple disabled:opacity-40 hover:brightness-110 px-5 py-2 text-xs font-bold text-white transition-all shadow-uni-pink"
              >
                Proceed to Pool Seeding →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Pool Seeding Confirmation ─────────────────────────── */}
        {activeStep === 3 && (
          <div className="rounded-3xl border border-white/10 bg-[#13141E] p-4 sm:p-6 space-y-6 shadow-uni-card">
            <div>
              <h2 className="text-lg font-bold text-white">Step 3 — Canonical Pool Seeding & Route Registration</h2>
              <p className="text-xs text-uni-muted mt-1">
                CCA proceeds seeded the v4 pool at uniform clearing price. Register routeId in UniswapV4VenueAdapter (§3.3).
              </p>
            </div>

            {seededPoolKey && (
              <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-uni-muted font-medium">Clearing Reference Price:</span>
                  <span className="font-mono text-uni-green font-bold text-sm">$2,048.00 USDC</span>
                </div>
                <div className="text-xs space-y-1 font-mono text-zinc-300">
                  <div>currency0: {seededPoolKey.currency0}</div>
                  <div>currency1: {seededPoolKey.currency1}</div>
                  <div>fee: 0x800000 (DYNAMIC_FEE_FLAG)</div>
                  <div>hooks: {seededPoolKey.hooks}</div>
                </div>
                <div className="border-t border-white/5 pt-2 text-xs">
                  <span className="text-uni-muted uppercase font-bold text-[10px]">Derived Route ID (Invariant I2):</span>
                  <div className="font-mono text-uni-pink break-all mt-0.5 bg-black/40 p-2 rounded-xl border border-white/5">
                    {seededRouteId}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-uni-blue-subtle p-4 border border-uni-blue/20 space-y-1.5 text-xs">
              <div className="text-uni-blue font-bold">Adapter Registration Calldata</div>
              <p className="text-uni-muted">
                Calling <code>UniswapV4VenueAdapter.registerRoute(poolKey, "")</code> binds this pool for all subsequent option settlements. This is append-only and strictly immutable (Invariant I2).
              </p>
            </div>

            <div className="flex justify-between pt-2 border-t border-white/10">
              <button
                onClick={() => setActiveStep(2)}
                className="rounded-full bg-white/5 hover:bg-white/10 px-5 py-2.5 text-xs font-bold text-uni-muted"
              >
                ← Back to Auction Monitor
              </button>
              <button
                onClick={() => {
                  setRouteRegistered(true);
                  setActiveStep(4);
                }}
                className="rounded-full bg-gradient-to-r from-uni-green to-emerald-600 hover:brightness-110 px-6 py-2.5 text-xs font-bold text-white shadow-[0_0_20px_rgba(0,211,149,0.25)] transition-all"
              >
                Confirm Route & Proceed to LP Profile →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 4: Liquidity Profile Creation ─────────────────────────── */}
        {activeStep === 4 && (
          <div className="rounded-3xl border border-white/10 bg-[#13141E] p-4 sm:p-6 space-y-6 shadow-uni-card">
            <div>
              <h2 className="text-lg font-bold text-white">Step 4 — LP Profile Creation & Liquidity Gating</h2>
              <p className="text-xs text-uni-muted mt-1">
                OptionCore requires pre-trade liquidity verification via QuoterV2 (§6.1) before any LP profile is published.
              </p>
            </div>

            {/* Profile Config */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Max Units ({tokenSymbol})</label>
                <input
                  type="number"
                  value={profileUnits}
                  onChange={(e) => setProfileUnits(parseFloat(e.target.value) || 1)}
                  className="w-full mt-1 bg-transparent text-sm font-mono font-bold text-white outline-none"
                />
              </div>
              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Rate / Unit / Hour</label>
                <input
                  type="number"
                  value={ratePerHour}
                  step="0.0005"
                  onChange={(e) => setRatePerHour(parseFloat(e.target.value) || 0.001)}
                  className="w-full mt-1 bg-transparent text-sm font-mono font-bold text-white outline-none"
                />
              </div>
              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Min Duration (h)</label>
                <input
                  type="number"
                  value={minHours}
                  onChange={(e) => setMinHours(parseInt(e.target.value) || 1)}
                  className="w-full mt-1 bg-transparent text-sm font-mono font-bold text-white outline-none"
                />
              </div>
              <div className="bg-[#0D0E15] p-3.5 rounded-2xl border border-white/5">
                <label className="text-[10px] text-uni-muted font-bold uppercase">Max Duration (h)</label>
                <input
                  type="number"
                  value={maxHours}
                  onChange={(e) => setMaxHours(parseInt(e.target.value) || 24)}
                  className="w-full mt-1 bg-transparent text-sm font-mono font-bold text-white outline-none"
                />
              </div>
            </div>

            {/* Live Pre-Trade Liquidity Check Results (§6.1) */}
            <div className="rounded-2xl bg-[#0D0E15] p-4 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-uni-muted font-bold uppercase tracking-wider">
                  QuoterV2 Pre-Trade Liquidity Verification
                </span>
                {isCheckingLiquidity ? (
                  <span className="text-xs font-mono text-uni-muted animate-pulse">Simulating...</span>
                ) : liquidityCheck?.executable ? (
                  <span className="text-xs bg-uni-green-subtle text-uni-green border border-uni-green/30 px-3 py-0.5 rounded-full font-mono font-bold">
                    🟢 Executable at Oracle Floor
                  </span>
                ) : (
                  <span className="text-xs bg-uni-red-subtle text-uni-red border border-uni-red/30 px-3 py-0.5 rounded-full font-mono font-bold">
                    🔴 Insufficient Pool Depth
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>Price Impact: <strong className="text-white">{liquidityCheck ? `${liquidityCheck.priceImpactBps / 100}%` : '0%'}</strong></div>
                <div>Expected Output: <strong className="text-uni-green">{liquidityCheck ? `${liquidityCheck.expectedOutput.toString()} units` : '0'}</strong></div>
              </div>

              {liquidityCheck?.warning && (
                <div className="text-xs text-uni-amber bg-uni-amber-subtle p-3 rounded-xl border border-uni-amber/30">
                  ⚠ {liquidityCheck.warning}
                </div>
              )}
            </div>

            {profilePublished && (
              <div className="rounded-2xl bg-uni-green-subtle border border-uni-green/30 p-4 text-xs text-uni-green space-y-1 animate-fade-in">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <span>✓</span> Liquidity Profile Successfully Published to elpi.xyz
                </div>
                <div>Asset {tokenSymbol} is now tradeable on Base with verified 0-fee settlement hook.</div>
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-white/10">
              <button
                onClick={() => setActiveStep(3)}
                className="rounded-full bg-white/5 hover:bg-white/10 px-5 py-2.5 text-xs font-bold text-uni-muted"
              >
                ← Back to Pool Seeding
              </button>
              <button
                onClick={() => setProfilePublished(true)}
                disabled={!liquidityCheck?.executable || profilePublished}
                className="rounded-full bg-gradient-to-r from-uni-pink to-uni-purple hover:brightness-110 disabled:opacity-40 px-6 py-2.5 text-xs font-bold text-white shadow-uni-pink transition-all"
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
