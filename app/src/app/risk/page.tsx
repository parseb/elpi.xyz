"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  InfoIcon,
  ShieldCheckIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "@/components/icons";
import { Badge, Card, Field, InfoTooltip, PageHeader, StatTile } from "@/components/ui";

interface AssetPreset {
  id: string;
  symbol: string;
  name: string;
  defaultPrice: number;
  unitScalar: number; // 0.01 standard
  unitLabel: string;
}

const ASSET_PRESETS: AssetPreset[] = [
  { id: "weth", symbol: "ETH", name: "Ethereum", defaultPrice: 3000, unitScalar: 0.01, unitLabel: "0.01 ETH" },
  { id: "wbtc", symbol: "BTC", name: "Bitcoin", defaultPrice: 60000, unitScalar: 0.01, unitLabel: "0.01 BTC" },
  { id: "nvda", symbol: "NVDA", name: "Nvidia", defaultPrice: 120, unitScalar: 0.01, unitLabel: "0.01 NVDA" },
];

const QUICK_SCENARIOS = [
  { label: "Severe Crash", pct: -50, desc: "-50% Market Plunge" },
  { label: "Moderate Dip", pct: -20, desc: "-20% Pullback" },
  { label: "Flat / Pin", pct: 0, desc: "0% Price Change" },
  { label: "Moderate Rally", pct: 20, desc: "+20% Upward Move" },
  { label: "Bull Surge", pct: 50, desc: "+50% Breakout" },
] as const;

export default function RiskPage() {
  const chartGradientId = useId();

  // Interactive Simulator State
  const [selectedAssetId, setSelectedAssetId] = useState<string>("weth");
  const [optionType, setOptionType] = useState<0 | 1>(0); // 0 = CALL, 1 = PUT
  const [entryPrice, setEntryPrice] = useState<number>(3000);
  const [units, setUnits] = useState<number>(100); // 100 units = 1.00 underlying
  const [durationHours, setDurationHours] = useState<number>(24);
  const [ratePerHour, setRatePerHour] = useState<number>(0.10); // $0.10 per unit per hour
  const [simulatedPctChange, setSimulatedPctChange] = useState<number>(15);
  const [activeTab, setActiveTab] = useState<"simulator" | "lp-deep-dive" | "taker-profile" | "matrix">("simulator");

  const currentAsset = useMemo(
    () => ASSET_PRESETS.find((a) => a.id === selectedAssetId) || ASSET_PRESETS[0],
    [selectedAssetId],
  );

  // When asset changes, update default price
  function handleSelectAsset(asset: AssetPreset) {
    setSelectedAssetId(asset.id);
    setEntryPrice(asset.defaultPrice);
    if (asset.id === "wbtc") {
      setRatePerHour(2.0); // realistic scale for BTC
    } else if (asset.id === "nvda") {
      setRatePerHour(0.005);
    } else {
      setRatePerHour(0.10);
    }
  }

  // Core Math Calculations
  const underlyingQty = useMemo(() => units * currentAsset.unitScalar, [units, currentAsset]);
  const totalYieldPaid = useMemo(() => units * ratePerHour * durationHours, [units, ratePerHour, durationHours]);
  const exitPrice = useMemo(() => entryPrice * (1 + simulatedPctChange / 100), [entryPrice, simulatedPctChange]);

  // Initial Capital Values in USD
  const initialCollateralUsd = useMemo(() => {
    // For CALL, LP commits underlying token (Qty * Entry Price)
    // For PUT, LP commits settlement asset USDC (Qty * Entry Price)
    return underlyingQty * entryPrice;
  }, [underlyingQty, entryPrice]);

  // Calculations for current simulated exit price
  const simulatedOutcome = useMemo(() => {
    const isCall = optionType === 0;
    const priceDiff = isCall ? exitPrice - entryPrice : entryPrice - exitPrice;
    const grossTakerPayout = Math.max(0, priceDiff * underlyingQty);
    const netTakerPL = grossTakerPayout - totalYieldPaid;
    const takerROI = totalYieldPaid > 0 ? (netTakerPL / totalYieldPaid) * 100 : 0;

    let lpTotalExitUsd = 0;
    let lpRemainingCollateralUsd = 0;
    let lpDivergenceLoss = 0; // Opportunity loss vs simple HODL

    if (isCall) {
      // CALL OPTION:
      // Underlying held: underlyingQty of asset
      const heldAssetGrossValue = underlyingQty * exitPrice;
      if (exitPrice > entryPrice) {
        // Taker exercises ITM: gross payout taken from collateral via swap
        lpRemainingCollateralUsd = heldAssetGrossValue - grossTakerPayout;
        // In USD, remaining collateral is exactly initial value!
        lpTotalExitUsd = lpRemainingCollateralUsd + totalYieldPaid;
      } else {
        // OTM: Taker leaves, LP reclaims 100% of collateral tokens
        lpRemainingCollateralUsd = heldAssetGrossValue;
        lpTotalExitUsd = lpRemainingCollateralUsd + totalYieldPaid;
      }
      // Benchmark: If LP just held the underlying token directly with no LPing
      const holdBenchmarkUsd = heldAssetGrossValue;
      lpDivergenceLoss = lpTotalExitUsd - holdBenchmarkUsd;
    } else {
      // PUT OPTION:
      // Settlement held: initialCollateralUsd (USDC)
      if (exitPrice < entryPrice) {
        // Taker exercises ITM: gross payout in USDC transferred to taker
        lpRemainingCollateralUsd = initialCollateralUsd - grossTakerPayout;
        lpTotalExitUsd = lpRemainingCollateralUsd + totalYieldPaid;
      } else {
        // OTM: LP retains 100% USDC collateral
        lpRemainingCollateralUsd = initialCollateralUsd;
        lpTotalExitUsd = lpRemainingCollateralUsd + totalYieldPaid;
      }
      // Benchmark for Put LP: holding pure cash/USDC
      const holdBenchmarkUsd = initialCollateralUsd;
      lpDivergenceLoss = lpTotalExitUsd - holdBenchmarkUsd;
    }

    const lpNetPLUsd = lpTotalExitUsd - initialCollateralUsd;
    const lpNetReturnPct = initialCollateralUsd > 0 ? (lpNetPLUsd / initialCollateralUsd) * 100 : 0;

    const takerBreakEven = isCall
      ? entryPrice + totalYieldPaid / underlyingQty
      : entryPrice - totalYieldPaid / underlyingQty;

    return {
      isCall,
      grossTakerPayout,
      netTakerPL,
      takerROI,
      lpTotalExitUsd,
      lpRemainingCollateralUsd,
      lpNetPLUsd,
      lpNetReturnPct,
      lpDivergenceLoss,
      takerBreakEven,
      isTakerInProfit: netTakerPL > 0,
      isOptionITM: grossTakerPayout > 0,
    };
  }, [optionType, exitPrice, entryPrice, underlyingQty, totalYieldPaid, initialCollateralUsd]);

  // Generate curve data points for the SVG Payoff Chart (-60% to +60%)
  const chartPoints = useMemo(() => {
    const isCall = optionType === 0;
    const points: Array<{
      pct: number;
      price: number;
      takerPL: number;
      lpPL: number;
      holdPL: number;
    }> = [];

    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const pct = -60 + (i / steps) * 120;
      const p = entryPrice * (1 + pct / 100);
      const grossPayout = isCall
        ? Math.max(0, (p - entryPrice) * underlyingQty)
        : Math.max(0, (entryPrice - p) * underlyingQty);

      const takerPL = grossPayout - totalYieldPaid;

      let lpPL = 0;
      let holdPL = 0;

      if (isCall) {
        const heldAssetGross = underlyingQty * p;
        const remainingCollateral = p > entryPrice ? heldAssetGross - grossPayout : heldAssetGross;
        const totalLpVal = remainingCollateral + totalYieldPaid;
        lpPL = totalLpVal - initialCollateralUsd;
        holdPL = heldAssetGross - initialCollateralUsd;
      } else {
        const remainingCollateral = p < entryPrice ? initialCollateralUsd - grossPayout : initialCollateralUsd;
        const totalLpVal = remainingCollateral + totalYieldPaid;
        lpPL = totalLpVal - initialCollateralUsd;
        holdPL = 0; // Cash benchmark
      }

      points.push({ pct, price: p, takerPL, lpPL, holdPL });
    }
    return points;
  }, [optionType, entryPrice, underlyingQty, totalYieldPaid, initialCollateralUsd]);

  // Chart dimensions and scales
  const chartSvg = useMemo(() => {
    const width = 840;
    const height = 360;
    const padding = { top: 28, right: 36, bottom: 44, left: 74 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    // Y scale domain: find min/max across all lines
    let minY = 0;
    let maxY = 0;
    chartPoints.forEach((pt) => {
      minY = Math.min(minY, pt.takerPL, pt.lpPL, pt.holdPL);
      maxY = Math.max(maxY, pt.takerPL, pt.lpPL, pt.holdPL);
    });

    // Add padding to domain
    const span = Math.max(1, maxY - minY);
    minY = Math.floor(minY - span * 0.1);
    maxY = Math.ceil(maxY + span * 0.1);

    const scaleX = (pct: number) => padding.left + ((pct - -60) / 120) * innerW;
    const scaleY = (val: number) => padding.top + (1 - (val - minY) / (maxY - minY)) * innerH;

    const zeroY = scaleY(0);

    // Build SVG paths
    const takerPath = chartPoints.reduce((acc, pt, i) => {
      const x = scaleX(pt.pct);
      const y = scaleY(pt.takerPL);
      return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, "");

    const lpPath = chartPoints.reduce((acc, pt, i) => {
      const x = scaleX(pt.pct);
      const y = scaleY(pt.lpPL);
      return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, "");

    const holdPath = chartPoints.reduce((acc, pt, i) => {
      const x = scaleX(pt.pct);
      const y = scaleY(pt.holdPL);
      return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, "");

    // LP fill area (from line to zero line)
    const lpAreaPath = `${lpPath} L ${scaleX(60)} ${zeroY} L ${scaleX(-60)} ${zeroY} Z`;

    // Current cursor X
    const cursorX = scaleX(simulatedPctChange);
    const cursorTakerY = scaleY(simulatedOutcome.netTakerPL);
    const cursorLpY = scaleY(simulatedOutcome.lpNetPLUsd);

    // Break-even X
    const breakEvenPct = ((simulatedOutcome.takerBreakEven - entryPrice) / entryPrice) * 100;
    const breakEvenX = scaleX(Math.max(-60, Math.min(60, breakEvenPct)));

    // Strike X (0%)
    const strikeX = scaleX(0);

    // Gridlines Y
    const yTicks = [minY, minY / 2, 0, maxY / 2, maxY].map((val) => ({
      val: Math.round(val),
      y: scaleY(val),
    }));

    // Gridlines X (-50%, -25%, 0%, +25%, +50%)
    const xTicks = [-50, -25, 0, 25, 50].map((pct) => ({
      pct,
      price: Math.round(entryPrice * (1 + pct / 100)),
      x: scaleX(pct),
    }));

    return {
      width,
      height,
      padding,
      innerW,
      innerH,
      zeroY,
      takerPath,
      lpPath,
      holdPath,
      lpAreaPath,
      cursorX,
      cursorTakerY,
      cursorLpY,
      strikeX,
      breakEvenX,
      breakEvenPct,
      yTicks,
      xTicks,
      scaleX,
      scaleY,
    };
  }, [chartPoints, simulatedPctChange, simulatedOutcome, entryPrice]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        title="Risk & Payoff Dynamics"
        description="A quantitative guide and interactive visualizer contrasting loss potential for Liquidity Providers and Takers on elpi.xyz."
        tooltip="elpi.xyz stages LP collateral in Uniswap v4 pools and enforces isolated per-position custody. Explore payoff asymmetries, capital exposure, and settlement mechanics."
      />

      {/* Top Level Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3 text-sm font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("simulator")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all cursor-pointer ${
            activeTab === "simulator"
              ? "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border border-[var(--base-blue-muted)] font-semibold"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
          }`}
        >
          <TrendingUpIcon size={16} />
          <span>Interactive Simulator</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("lp-deep-dive")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all cursor-pointer ${
            activeTab === "lp-deep-dive"
              ? "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border border-[var(--base-blue-muted)] font-semibold"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
          }`}
        >
          <span className="flex h-2 w-2 rounded-full bg-[var(--amber-text)]" />
          <span>LP Risk Deep Dive (Focus)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("taker-profile")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all cursor-pointer ${
            activeTab === "taker-profile"
              ? "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border border-[var(--base-blue-muted)] font-semibold"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
          }`}
        >
          <ShieldCheckIcon size={16} />
          <span>Taker Risk Profile</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("matrix")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all cursor-pointer ${
            activeTab === "matrix"
              ? "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border border-[var(--base-blue-muted)] font-semibold"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
          }`}
        >
          <InfoIcon size={16} />
          <span>Side-by-Side Matrix</span>
        </button>
      </div>

      {/* Quick Summary Stat Tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Taker Maximum Loss"
          value="100% of Yield Paid"
          sub="Strictly bounded, non-recourse premium"
          accent="blue"
          tooltip="A taker pays an upfront yield at mint. Under no circumstance can a taker lose more than this amount. No margin calls, no liquidations."
        />
        <StatTile
          label="LP Maximum Profit"
          value={`+$${totalYieldPaid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="Capped strictly at upfront yield collected"
          accent="cyan"
          tooltip="The LP's financial upside is strictly capped at the yield agreed in the profile/quote. LPs never capture underlying price moonshots beyond the entry price."
        />
        <StatTile
          label="LP Downside Exposure"
          value={optionType === 0 ? "Underlying Drop" : "Strike Liability"}
          sub={optionType === 0 ? "Bears 100% of spot drop (net of yield)" : "Collateral depleted as price falls"}
          accent="amber"
          tooltip="CALL LPs hold depreciating underlying tokens if price drops. PUT LPs surrender cash collateral to takers if price drops below entry."
        />
        <StatTile
          label="Collateral Custody"
          value="Isolated TBA"
          sub="ERC-6551 Account (Zero cross-risk)"
          accent="neutral"
          tooltip="Every position has its own isolated PositionAccount. Collateral is physically separated, bounding risk strictly to that single contract."
        />
      </div>

      {/* MAIN TAB 1: INTERACTIVE SIMULATOR */}
      {activeTab === "simulator" && (
        <div className="flex flex-col gap-6">
          {/* Controls Bar */}
          <Card className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Option Type:
                </span>
                <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1">
                  <button
                    type="button"
                    onClick={() => setOptionType(0)}
                    className={`rounded-md px-4 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      optionType === 0
                        ? "bg-[var(--emerald-bg)] text-[var(--emerald-text)] border border-[var(--emerald-border)] shadow-xs"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    CALL Option
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptionType(1)}
                    className={`rounded-md px-4 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      optionType === 1
                        ? "bg-[var(--amber-bg)] text-[var(--amber-text)] border border-[var(--amber-border)] shadow-xs"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    PUT Option
                  </button>
                </div>
              </div>

              {/* Asset Selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Underlying:
                </span>
                <div className="inline-flex gap-1.5">
                  {ASSET_PRESETS.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => handleSelectAsset(asset)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        selectedAssetId === asset.id
                          ? "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border border-[var(--base-blue-muted)]"
                          : "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {asset.symbol}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Parameter Inputs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Entry Price ($ Spot)" tooltip="Initial asset spot price recorded at mint time.">
                <input
                  type="number"
                  step="any"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(Math.max(0.01, Number(e.target.value)))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-2 text-sm font-mono text-[var(--foreground)] focus:border-[var(--base-blue)] focus:outline-none"
                />
              </Field>

              <Field label="Units (1 Unit = 0.01 Token)" tooltip="Size of option agreement. 100 units = 1.00 Underlying Token.">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={units}
                    onChange={(e) => setUnits(Math.max(1, Math.round(Number(e.target.value))))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-2 text-sm font-mono text-[var(--foreground)] focus:border-[var(--base-blue)] focus:outline-none"
                  />
                  <span className="shrink-0 text-xs font-mono text-[var(--text-muted)]">
                    = {underlyingQty.toFixed(2)} {currentAsset.symbol}
                  </span>
                </div>
              </Field>

              <Field label="Duration (Hours)" tooltip="Option lifetime before reaching expiry.">
                <div className="flex items-center gap-1.5">
                  {[24, 72, 168, 720].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setDurationHours(h)}
                      className={`flex-1 rounded-md py-1.5 text-center font-mono text-xs font-semibold cursor-pointer transition-colors ${
                        durationHours === h
                          ? "bg-[var(--base-blue)] text-white"
                          : "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {h >= 24 ? `${h / 24}d` : `${h}h`}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Yield Rate ($/unit/hr)" tooltip="Fee rate quoted by the LP profile/quote.">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={ratePerHour}
                    onChange={(e) => setRatePerHour(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-2 text-sm font-mono text-[var(--foreground)] focus:border-[var(--base-blue)] focus:outline-none"
                  />
                  <span className="shrink-0 text-xs font-mono text-[var(--emerald-text)]">
                    Yield: ${totalYieldPaid.toFixed(2)}
                  </span>
                </div>
              </Field>
            </div>

            {/* Scenario Buttons & Slider */}
            <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Simulate Price Move:
                  </span>
                  <span
                    className={`font-mono text-sm font-bold ${
                      simulatedPctChange > 0
                        ? "text-[var(--emerald-text)]"
                        : simulatedPctChange < 0
                        ? "text-[var(--red-text)]"
                        : "text-[var(--foreground)]"
                    }`}
                  >
                    {simulatedPctChange >= 0 ? `+${simulatedPctChange}%` : `${simulatedPctChange}%`}
                    {" "}
                    (${exitPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </span>
                </div>

                {/* Scenario Presets */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_SCENARIOS.map((sc) => (
                    <button
                      key={sc.pct}
                      type="button"
                      onClick={() => setSimulatedPctChange(sc.pct)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                        simulatedPctChange === sc.pct
                          ? "bg-[var(--foreground)] text-[var(--background)] font-bold shadow-xs"
                          : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {sc.label} ({sc.pct >= 0 ? `+${sc.pct}%` : `${sc.pct}%`})
                    </button>
                  ))}
                </div>
              </div>

              {/* Range Slider */}
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-[var(--red-text)]">-60%</span>
                <input
                  type="range"
                  min="-60"
                  max="60"
                  step="1"
                  value={simulatedPctChange}
                  onChange={(e) => setSimulatedPctChange(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[var(--surface-overlay)] accent-[var(--base-blue)]"
                  aria-label="Simulated percentage price change"
                />
                <span className="font-mono text-xs text-[var(--emerald-text)]">+60%</span>
              </div>
            </div>
          </Card>

          {/* Interactive SVG Payoff Chart */}
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-base font-bold text-[var(--foreground)]">
                  Payoff & Net Outcome Curve ({optionType === 0 ? "CALL" : "PUT"} Option)
                </h2>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Comparing Net Dollar Outcomes for LP vs. Taker vs. Holding Underlying directly across market outcomes.
                </p>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-5 rounded-xs bg-[var(--amber-text)]" />
                  <span className="font-medium text-[var(--foreground)]">LP Net P&L</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-5 rounded-xs bg-[var(--base-blue-light)]" />
                  <span className="font-medium text-[var(--foreground)]">Taker Net P&L</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-0.5 w-5 border-t border-dashed border-[var(--text-muted)]" />
                  <span className="text-[var(--text-muted)]">Hold Underlying (Benchmark)</span>
                </div>
              </div>
            </div>

            {/* SVG Visualizer */}
            <div className="relative w-full overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-2">
              <svg
                viewBox={`0 0 ${chartSvg.width} ${chartSvg.height}`}
                className="w-full h-auto min-w-[640px] select-none font-mono"
                role="img"
                aria-label="Option Payoff Graph showing LP and Taker outcomes"
              >
                <defs>
                  <linearGradient id={`${chartGradientId}-lp`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Gridlines */}
                {chartSvg.yTicks.map((tick, i) => (
                  <g key={`y-${i}`}>
                    <line
                      x1={chartSvg.padding.left}
                      y1={tick.y}
                      x2={chartSvg.width - chartSvg.padding.right}
                      y2={tick.y}
                      stroke="var(--border)"
                      strokeWidth={tick.val === 0 ? "1.5" : "1"}
                      strokeDasharray={tick.val === 0 ? undefined : "3 3"}
                    />
                    <text
                      x={chartSvg.padding.left - 10}
                      y={tick.y + 4}
                      textAnchor="end"
                      className="fill-[var(--text-muted)] text-[11px]"
                    >
                      {tick.val >= 0 ? `+$${tick.val}` : `-$${Math.abs(tick.val)}`}
                    </text>
                  </g>
                ))}

                {/* Vertical Gridlines */}
                {chartSvg.xTicks.map((tick, i) => (
                  <g key={`x-${i}`}>
                    <line
                      x1={tick.x}
                      y1={chartSvg.padding.top}
                      x2={tick.x}
                      y2={chartSvg.height - chartSvg.padding.bottom}
                      stroke="var(--border)"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={tick.x}
                      y={chartSvg.height - chartSvg.padding.bottom + 18}
                      textAnchor="middle"
                      className="fill-[var(--text-muted)] text-[11px]"
                    >
                      {tick.pct >= 0 ? `+${tick.pct}%` : `${tick.pct}%`}
                    </text>
                    <text
                      x={tick.x}
                      y={chartSvg.height - chartSvg.padding.bottom + 32}
                      textAnchor="middle"
                      className="fill-[var(--text-disabled)] text-[10px]"
                    >
                      ${tick.price}
                    </text>
                  </g>
                ))}

                {/* Strike Price Landmark (0% deviation) */}
                <line
                  x1={chartSvg.strikeX}
                  y1={chartSvg.padding.top}
                  x2={chartSvg.strikeX}
                  y2={chartSvg.height - chartSvg.padding.bottom}
                  stroke="var(--foreground)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <text
                  x={chartSvg.strikeX + 4}
                  y={chartSvg.padding.top + 14}
                  className="fill-[var(--foreground)] text-[11px] font-bold"
                >
                  Strike (${entryPrice})
                </text>

                {/* Taker Break-Even Landmark */}
                {chartSvg.breakEvenPct >= -60 && chartSvg.breakEvenPct <= 60 && (
                  <>
                    <line
                      x1={chartSvg.breakEvenX}
                      y1={chartSvg.padding.top}
                      x2={chartSvg.breakEvenX}
                      y2={chartSvg.height - chartSvg.padding.bottom}
                      stroke="var(--base-blue-light)"
                      strokeWidth="1.2"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={chartSvg.breakEvenX + (optionType === 0 ? 4 : -4)}
                      y={chartSvg.padding.top + 30}
                      textAnchor={optionType === 0 ? "start" : "end"}
                      className="fill-[var(--base-blue-light)] text-[10px] font-semibold"
                    >
                      Taker B/E (${simulatedOutcome.takerBreakEven.toFixed(1)})
                    </text>
                  </>
                )}

                {/* LP Area Fill */}
                <path d={chartSvg.lpAreaPath} fill={`url(#${chartGradientId}-lp)`} />

                {/* Hold Benchmark Line */}
                <path
                  d={chartSvg.holdPath}
                  fill="none"
                  stroke="var(--text-muted)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />

                {/* Taker Line */}
                <path
                  d={chartSvg.takerPath}
                  fill="none"
                  stroke="var(--base-blue)"
                  strokeWidth="2.5"
                />

                {/* LP Line */}
                <path
                  d={chartSvg.lpPath}
                  fill="none"
                  stroke="var(--amber-text)"
                  strokeWidth="3"
                />

                {/* Interactive Simulated Price Cursor */}
                <line
                  x1={chartSvg.cursorX}
                  y1={chartSvg.padding.top}
                  x2={chartSvg.cursorX}
                  y2={chartSvg.height - chartSvg.padding.bottom}
                  stroke="var(--foreground)"
                  strokeWidth="2"
                />
                {/* Dots on Curves */}
                <circle cx={chartSvg.cursorX} cy={chartSvg.cursorLpY} r="5" fill="var(--amber-text)" stroke="#fff" strokeWidth="1.5" />
                <circle cx={chartSvg.cursorX} cy={chartSvg.cursorTakerY} r="5" fill="var(--base-blue)" stroke="#fff" strokeWidth="1.5" />
              </svg>
            </div>

            {/* Live Comparison Breakdown Cards */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Taker Outcome Card */}
              <div className="flex flex-col gap-3 rounded-xl border border-[var(--base-blue-muted)] bg-[var(--surface-raised)] p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-3 w-3 rounded-full bg-[var(--base-blue)]" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--base-blue-light)]">
                      Taker Outcome (Option Buyer)
                    </h3>
                  </div>
                  <Badge tone={simulatedOutcome.isTakerInProfit ? "emerald" : "neutral"}>
                    {simulatedOutcome.isTakerInProfit
                      ? "Profitable Position"
                      : simulatedOutcome.isOptionITM
                      ? "ITM but Below Break-Even"
                      : "Expired Worthless (Max Loss)"}
                  </Badge>
                </div>

                <div className="mt-1 flex items-baseline justify-between border-b border-[var(--border)] pb-3">
                  <span className="text-xs text-[var(--text-muted)]">Net P&L:</span>
                  <span
                    className={`font-mono text-2xl font-bold ${
                      simulatedOutcome.netTakerPL > 0
                        ? "text-[var(--emerald-text)]"
                        : simulatedOutcome.netTakerPL < 0
                        ? "text-[var(--red-text)]"
                        : "text-[var(--foreground)]"
                    }`}
                  >
                    {simulatedOutcome.netTakerPL >= 0 ? "+" : ""}$
                    {simulatedOutcome.netTakerPL.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    <span className="ml-2 text-xs font-normal">
                      ({simulatedOutcome.takerROI >= 0 ? "+" : ""}
                      {simulatedOutcome.takerROI.toFixed(1)}% ROI)
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-[var(--surface)] p-2.5">
                    <span className="text-[var(--text-muted)]">Gross Payoff:</span>
                    <p className="mt-0.5 font-mono font-bold text-[var(--foreground)]">
                      ${simulatedOutcome.grossTakerPayout.toFixed(2)} USDC
                    </p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface)] p-2.5">
                    <span className="text-[var(--text-muted)]">Upfront Yield Paid:</span>
                    <p className="mt-0.5 font-mono font-bold text-[var(--red-text)]">
                      -${totalYieldPaid.toFixed(2)} USDC
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-xs leading-relaxed text-[var(--text-muted)]">
                  <strong className="text-[var(--foreground)]">Key Taker Protection:</strong> Your maximum possible loss is strictly capped at the upfront yield fee (${totalYieldPaid.toFixed(2)}). You can never lose more, even if the asset crashes to zero or rallies 1000%. Zero liquidation risk.
                </div>
              </div>

              {/* LP Outcome Card */}
              <div className="flex flex-col gap-3 rounded-xl border border-[var(--amber-border)] bg-[var(--surface-raised)] p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-3 w-3 rounded-full bg-[var(--amber-text)]" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--amber-text)]">
                      LP Outcome (Liquidity Provider)
                    </h3>
                  </div>
                  <Badge tone={simulatedOutcome.lpNetPLUsd >= 0 ? "emerald" : "amber"}>
                    {simulatedOutcome.lpNetPLUsd >= 0 ? "Net Profit" : "Net Loss on Position"}
                  </Badge>
                </div>

                <div className="mt-1 flex items-baseline justify-between border-b border-[var(--border)] pb-3">
                  <span className="text-xs text-[var(--text-muted)]">Net USD P&L:</span>
                  <span
                    className={`font-mono text-2xl font-bold ${
                      simulatedOutcome.lpNetPLUsd > 0
                        ? "text-[var(--emerald-text)]"
                        : simulatedOutcome.lpNetPLUsd < 0
                        ? "text-[var(--red-text)]"
                        : "text-[var(--foreground)]"
                    }`}
                  >
                    {simulatedOutcome.lpNetPLUsd >= 0 ? "+" : ""}$
                    {simulatedOutcome.lpNetPLUsd.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    <span className="ml-2 text-xs font-normal">
                      ({simulatedOutcome.lpNetReturnPct >= 0 ? "+" : ""}
                      {simulatedOutcome.lpNetReturnPct.toFixed(1)}% on Capital)
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-[var(--surface)] p-2.5">
                    <span className="text-[var(--text-muted)]">Collateral Value Returned:</span>
                    <p className="mt-0.5 font-mono font-bold text-[var(--foreground)]">
                      ${simulatedOutcome.lpRemainingCollateralUsd.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface)] p-2.5">
                    <span className="text-[var(--text-muted)]">Yield Kept Upfront:</span>
                    <p className="mt-0.5 font-mono font-bold text-[var(--emerald-text)]">
                      +${totalYieldPaid.toFixed(2)} USDC
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-xs leading-relaxed text-[var(--text-muted)]">
                  <strong className="text-[var(--amber-text)]">The LP Asymmetry Trap:</strong> Your profit is strictly capped at +${totalYieldPaid.toFixed(2)}.
                  {optionType === 0 ? (
                    simulatedPctChange > 0 ? (
                      <span> On this rally (+{simulatedPctChange}%), you missed out on <strong className="text-[var(--red-text)]">${Math.abs(simulatedOutcome.lpDivergenceLoss).toFixed(2)}</strong> of upside because the taker extracted the appreciation.</span>
                    ) : (
                      <span> On this decline ({simulatedPctChange}%), you keep the token but absorb the spot decline, only softened by the small yield fee.</span>
                    )
                  ) : (
                    simulatedPctChange < 0 ? (
                      <span> On this drop ({simulatedPctChange}%), your USDC collateral was depleted by <strong className="text-[var(--red-text)]">${simulatedOutcome.grossTakerPayout.toFixed(2)}</strong> to settle the taker.</span>
                    ) : (
                      <span> Asset held stable/rallied; you kept your full USDC collateral plus the yield fee.</span>
                    )
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* MAIN TAB 2: LP RISK DEEP DIVE */}
      {activeTab === "lp-deep-dive" && (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-[var(--amber-border)] bg-[var(--amber-bg)] p-5 text-sm text-[var(--foreground)]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--amber-text)] font-bold text-black text-xs">
                !
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="font-bold text-base text-[var(--amber-text)]">
                  Why Providing Liquidity (LPing) is Less Intuitive Than Taking
                </h2>
                <p className="leading-relaxed text-xs text-[var(--text-secondary)]">
                  In options markets, option buyers (takers) have a mathematically simple risk profile: they buy convexity with a pre-determined maximum loss. Liquidity providers, by contrast, act as underwriters (selling convexity). While the yield earned looks like a steady fixed-income return, the underlying capital is exposed to severe directional risk, upside forfeiture, and collateral lockup.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Aspect 1: The Asymmetry Paradox */}
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--amber-bg)] font-mono text-xs font-bold text-[var(--amber-text)]">
                  1
                </span>
                <h3 className="text-base font-bold text-[var(--foreground)]">
                  The Asymmetric Payoff Paradox
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                When you publish a <code className="text-[var(--base-blue-light)]">LiquidityProfile</code> or <code className="text-[var(--base-blue-light)]">BackerQuote</code>, you set an hourly yield rate (e.g. 15% annualized). That yield is your <strong>maximum upside</strong>.
              </p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs flex flex-col gap-2">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Max LP Gain:</span>
                  <span className="font-mono font-bold text-[var(--emerald-text)]">+Upfront Yield (e.g. +2.4%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Max LP Downside:</span>
                  <span className="font-mono font-bold text-[var(--red-text)]">Up to -100% of Collateral (net of yield)</span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Unlike a spot holder who enjoys unlimited upside, or a Uniswap LP who holds a continuous 50/50 rebalancing basket, an option LP sells away the extreme tail of the distribution. A single 40% crash wipes out months of accumulated premium.
              </p>
            </Card>

            {/* Aspect 2: CALL LP Exposure */}
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--base-blue-faint)] font-mono text-xs font-bold text-[var(--base-blue-light)]">
                  2
                </span>
                <h3 className="text-base font-bold text-[var(--foreground)]">
                  CALL LP: Synthetic Covered Call Exposure
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                To back a CALL option, the LP deposits the underlying asset (e.g., <strong>WETH</strong>).
              </p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span className="text-[var(--red-text)]">▼</span>
                  <div>
                    <strong className="text-[var(--foreground)]">When Spot Rallies:</strong> Taker exercises early via <code className="text-[var(--base-blue-light)]">TakerProfitCondition</code>. Contract swaps the profit portion <code className="text-xs">(Exit - Entry) × Units</code> into USDC for the taker. LP gets back the remaining WETH. In USD terms, the LP's position value is capped at <code className="text-xs">Entry Value + Yield</code>. The LP misses the moonshot.
                  </div>
                </div>
                <div className="flex items-start gap-2 border-t border-[var(--border)] pt-2">
                  <span className="text-[var(--red-text)]">▼</span>
                  <div>
                    <strong className="text-[var(--foreground)]">When Spot Crashes:</strong> Taker does not exercise. At expiry, LP reclaims 100% of their WETH tokens. However, the market value of those tokens has plummeted. The small yield fee barely cushions the loss.
                  </div>
                </div>
              </div>
            </Card>

            {/* Aspect 3: PUT LP Exposure */}
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--amber-bg)] font-mono text-xs font-bold text-[var(--amber-text)]">
                  3
                </span>
                <h3 className="text-base font-bold text-[var(--foreground)]">
                  PUT LP: Cash-Secured Put Liability
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                To back a PUT option, the LP deposits the settlement token (e.g., <strong>USDC</strong>) covering the full strike value.
              </p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span className="text-[var(--emerald-text)]">▲</span>
                  <div>
                    <strong className="text-[var(--foreground)]">When Spot Rallies:</strong> Taker does not exercise. At expiry, LP receives back 100% of their USDC collateral plus keeps 100% of the yield payment.
                  </div>
                </div>
                <div className="flex items-start gap-2 border-t border-[var(--border)] pt-2">
                  <span className="text-[var(--red-text)]">▼</span>
                  <div>
                    <strong className="text-[var(--foreground)]">When Spot Crashes:</strong> Taker settles when profitable. Taker receives the price drop <code className="text-xs">(Entry - Exit) × Units</code> paid directly out of the LP's USDC collateral. The LP absorbs the full market drop in dollar terms.
                  </div>
                </div>
              </div>
            </Card>

            {/* Aspect 4: Invariant I3 & Post-Expiry Settlement */}
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-overlay)] font-mono text-xs font-bold text-[var(--foreground)]">
                  4
                </span>
                <h3 className="text-base font-bold text-[var(--foreground)]">
                  Invariant I3 & The Post-Expiry "No-Swap" Nuance
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                A critical architectural distinction in elpi.xyz is <strong>Invariant I3</strong>: post-expiry settlement must execute without relying on oracle liveness or DEX swap liquidity.
              </p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-xs flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span className="text-[var(--base-blue-light)] font-bold">Pre-Expiry:</span>
                  <span>Taker settles via <code className="text-[var(--base-blue-light)]">TakerProfitCondition</code>; profit is swapped via on-chain venue, and PUT remainder is swapped back to collateral asset for LP.</span>
                </div>
                <div className="flex items-start gap-2 border-t border-[var(--border)] pt-2">
                  <span className="text-[var(--amber-text)] font-bold">Post-Expiry:</span>
                  <span>LP settles via <code className="text-[var(--amber-text)]">ExpiryCondition</code>. The contract performs <strong>NO SWAP AT ALL</strong>. A PUT LP recovering collateral post-expiry receives <strong>USDC</strong>, not the underlying token!</span>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                This guarantees funds can never be frozen by an oracle outage, but means LPs must be aware of what asset denomination they receive back.
              </p>
            </Card>

            {/* Aspect 5: Capital Lockup & Illiquidity */}
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--red-bg)] font-mono text-xs font-bold text-[var(--red-text)]">
                  5
                </span>
                <h3 className="text-base font-bold text-[var(--foreground)]">
                  No Unilateral Early Withdrawal (Locked Collateral)
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Unlike automated market makers (AMMs) where you can pull liquidity anytime:
              </p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs flex flex-col gap-2">
                <p>
                  Once a position is minted, the LP's collateral is pulled into an isolated ERC-6551 Token Bound Account (<code className="text-[var(--base-blue-light)]">PositionAccount</code>).
                </p>
                <p>
                  The LP <strong>cannot</strong> unilaterally cancel, withdraw, or recover collateral before the expiry timestamp has elapsed, regardless of market volatility.
                </p>
                <p className="text-[var(--text-muted)]">
                  The only pre-expiry exit is <code className="text-[var(--base-blue-light)]">MutualUnwind</code>, which requires both the LP and the Taker to co-sign an agreed pro-rata split.
                </p>
              </div>
            </Card>

            {/* Aspect 6: Multi-LP Router Allocation */}
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--emerald-bg)] font-mono text-xs font-bold text-[var(--emerald-text)]">
                  6
                </span>
                <h3 className="text-base font-bold text-[var(--foreground)]">
                  Multi-LP Backer Pro-Rata Exposure (LPRouter)
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                When positions are filled across multiple backers via <code className="text-[var(--base-blue-light)]">LPRouter.matchAndMint</code>:
              </p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs flex flex-col gap-2">
                <p>
                  Each backer commits capital according to their signed <code className="text-[var(--base-blue-light)]">BackerQuote</code>.
                </p>
                <p>
                  Taker payoffs are deducted proportionally to each backer's contributed units.
                </p>
                <p>
                  Settlement payouts are routed through <code className="text-[var(--base-blue-light)]">ILPSettlementHook</code>, ensuring each backer receives their exact pro-rata remaining collateral balance.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* MAIN TAB 3: TAKER RISK PROFILE */}
      {activeTab === "taker-profile" && (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-[var(--base-blue-muted)] bg-[var(--base-blue-faint)] p-5 text-sm text-[var(--foreground)]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--base-blue)] font-bold text-white text-xs">
                i
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="font-bold text-base text-[var(--base-blue-light)]">
                  Taker Risk: Bounded, Non-Recourse, and Capped at Yield
                </h2>
                <p className="leading-relaxed text-xs text-[var(--text-secondary)]">
                  For option buyers (takers), elpi.xyz provides maximum capital safety. When taking an option, your maximum loss is strictly fixed to the penny at the moment of minting.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon size={20} className="text-[var(--emerald-text)]" />
                <h3 className="text-base font-bold text-[var(--foreground)]">Zero Liquidation Risk</h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Unlike perpetual futures or leveraged lending markets, you cannot be margin-called or liquidated. If the underlying asset drops 90%, you don't owe any debt or maintenance margin.
              </p>
            </Card>

            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ClockIcon size={20} className="text-[var(--amber-text)]" />
                <h3 className="text-base font-bold text-[var(--foreground)]">Theta (Time Decay) Risk</h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                The primary risk a taker faces is <strong>time decay</strong>. You paid for a specific duration window (e.g. 24 hours). If the price fails to move past your break-even price before expiry, the entire premium is lost.
              </p>
            </Card>

            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <TrendingUpIcon size={20} className="text-[var(--base-blue-light)]" />
                <h3 className="text-base font-bold text-[var(--foreground)]">Automated Exercise</h3>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                With <code className="text-[var(--base-blue-light)]">TakerProfitCondition</code>, you can settle and extract your profit anytime pre-expiry with a 2-of-3 threshold signature (Taker + ConditionArbiter). No LP consent required.
              </p>
            </Card>
          </div>

          {/* Formula Breakdown Card */}
          <Card className="flex flex-col gap-4">
            <h3 className="text-base font-bold text-[var(--foreground)]">Taker Profit & Loss Formulas</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs font-mono">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 flex flex-col gap-2">
                <span className="font-bold text-[var(--emerald-text)]">CALL Option P&L:</span>
                <p className="text-[var(--foreground)]">Gross Payoff = (Exit Price - Entry Price) × Units × 0.01</p>
                <p className="text-[var(--text-muted)]">Net P&L = Gross Payoff - Total Yield Paid</p>
                <p className="text-[var(--base-blue-light)]">Break-Even = Entry Price + (Yield / Underlying Qty)</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 flex flex-col gap-2">
                <span className="font-bold text-[var(--amber-text)]">PUT Option P&L:</span>
                <p className="text-[var(--foreground)]">Gross Payoff = (Entry Price - Exit Price) × Units × 0.01</p>
                <p className="text-[var(--text-muted)]">Net P&L = Gross Payoff - Total Yield Paid</p>
                <p className="text-[var(--base-blue-light)]">Break-Even = Entry Price - (Yield / Underlying Qty)</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* MAIN TAB 4: SIDE-BY-SIDE MATRIX */}
      {activeTab === "matrix" && (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)]">
              Comprehensive Comparison: Taker vs. Liquidity Provider
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Detailed structural matrix highlighting rights, obligations, capital lockup, and risk parameters.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <tr>
                  <th className="p-3.5 font-semibold">Parameter / Risk Vector</th>
                  <th className="p-3.5 font-semibold text-[var(--base-blue-light)]">Taker (Option Buyer)</th>
                  <th className="p-3.5 font-semibold text-[var(--amber-text)]">Liquidity Provider (Option LP)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-[var(--text-secondary)]">
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Maximum Loss</td>
                  <td className="p-3.5 font-mono text-[var(--emerald-text)]">
                    Strictly Capped at 100% of Yield Paid ($...)
                  </td>
                  <td className="p-3.5 font-mono text-[var(--red-text)]">
                    Substantial: Up to 100% of Collateral (net of yield)
                  </td>
                </tr>
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Maximum Gain</td>
                  <td className="p-3.5 font-mono text-[var(--foreground)]">
                    Theoretically Unlimited (Call) / Strike (Put)
                  </td>
                  <td className="p-3.5 font-mono text-[var(--emerald-text)]">
                    Strictly Capped at 100% of Yield Collected
                  </td>
                </tr>
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Market Direction Bias</td>
                  <td className="p-3.5">
                    Bullish (Call) or Bearish (Put). Needs sharp price movement.
                  </td>
                  <td className="p-3.5">
                    Neutral to Moderately Bullish (Call) / Neutral to Bullish (Put). Profits when market stays quiet.
                  </td>
                </tr>
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Impact of Time (Theta)</td>
                  <td className="p-3.5 text-[var(--red-text)]">
                    Negative (Time decay burns premium every hour)
                  </td>
                  <td className="p-3.5 text-[var(--emerald-text)]">
                    Positive (Time decay locks in yield as expiry approaches)
                  </td>
                </tr>
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Capital Lockup & Liquidity</td>
                  <td className="p-3.5">
                    Holds transferable ERC-721 NFT; can settle early if profitable.
                  </td>
                  <td className="p-3.5 text-[var(--amber-text)]">
                    Collateral locked in TBA until expiry. No unilateral exit.
                  </td>
                </tr>
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Margin & Liquidation</td>
                  <td className="p-3.5 text-[var(--emerald-text)]">
                    Zero. Fully cash-funded upfront.
                  </td>
                  <td className="p-3.5 text-[var(--emerald-text)]">
                    Zero. 100% collateralized in isolated PositionAccount.
                  </td>
                </tr>
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Settlement Threshold</td>
                  <td className="p-3.5">
                    2-of-3 (Taker + ConditionArbiter) pre-expiry
                  </td>
                  <td className="p-3.5">
                    2-of-3 (LP + ConditionArbiter) post-expiry
                  </td>
                </tr>
                <tr className="hover:bg-[var(--surface-raised)]/50">
                  <td className="p-3.5 font-medium text-[var(--foreground)]">Post-Expiry Invariant (I3)</td>
                  <td className="p-3.5">
                    No claim after expiry if unsettled.
                  </td>
                  <td className="p-3.5 font-mono text-[var(--amber-text)]">
                    No-swap settlement: CALL gets token; PUT gets USDC.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Footer Call to Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
        <div>
          <h3 className="text-base font-bold text-[var(--foreground)]">Ready to Trade or Provide Liquidity?</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Explore live order depth on the market chart or sign a liquidity profile to start earning yield.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-[var(--base-blue)] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-[var(--base-blue-hover)]"
          >
            <span>Take an Option</span>
            <ArrowRightIcon size={14} className="ml-1.5" />
          </Link>
          <Link
            href="/lp"
            className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition-all hover:bg-[var(--surface-overlay)]"
          >
            <span>Become an LP</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
