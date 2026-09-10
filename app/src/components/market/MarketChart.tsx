"use client";

import { useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { addresses } from "@/config/addresses";
import { allocate, entryCapacity, entryHumanRate, entryProvider, remainingUnits, type MarketEntry } from "@/lib/market";
import { assetDisplaySymbol, assetName, assetSymbol, assetToUnits, formatAsset, getSupportedAssets, unitsToAsset } from "@/lib/assetLabels";
import { getCounterparty } from "@/lib/counterparties";
import {
  clamp,
  formatDuration,
  formatDurationFull,
  linearTicks,
  logSamplePoints,
  logTicks,
  makeLinearScale,
  makeLogScale,
  parseDuration,
  rangeDepthCurve,
  type Scale,
} from "@/lib/charts";
import { Badge, InfoTooltip, Tooltip } from "@/components/ui";
import { CheckIcon, CloseIcon, EditIcon, SearchIcon } from "@/components/icons";

interface Props {
  selectedAsset?: Address;
  onSelectAsset?: (a: Address) => void;
  entries: MarketEntry[];
  consumedByHash: Record<Hex, bigint>;
  duration: number;
  desiredUnits: bigint;
  onDurationChange: (v: number) => void;
  onDesiredUnitsChange: (v: bigint) => void;
  onSelectEntry?: (entry: MarketEntry) => void;
}

const WIDTH = 900;
const HEIGHT = 560;
const MARGIN = { top: 32, right: 24, bottom: 76, left: 96 };
const PLOT_LEFT = MARGIN.left;
const PLOT_TOP = MARGIN.top;
const PLOT_RIGHT = WIDTH - MARGIN.right;
const PLOT_BOTTOM = HEIGHT - MARGIN.bottom;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;

const UNITS_TRACK_X = PLOT_LEFT - 24;
const DURATION_TRACK_Y = PLOT_BOTTOM + 22;

const MIN_RECT_WIDTH = 4;
const DEPTH_SAMPLES = 64;

type DragTarget = "duration" | "units" | "center" | null;

export function MarketChart({
  selectedAsset = addresses.collateralAsset,
  onSelectAsset,
  entries,
  consumedByHash,
  duration,
  desiredUnits,
  onDurationChange,
  onDesiredUnitsChange,
  onSelectEntry,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragTarget>(null);
  const [hover, setHover] = useState<{ entry: MarketEntry; x: number; y: number } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MarketEntry | null>(null);
  const [highlightedHash, setHighlightedHash] = useState<Hex | null>(null);
  const [hoverUnitsHandle, setHoverUnitsHandle] = useState(false);
  const [hoverDurationHandle, setHoverDurationHandle] = useState(false);
  const [hoverCenterHandle, setHoverCenterHandle] = useState(false);

  const [isEditingDuration, setIsEditingDuration] = useState(false);
  const [tempDurationStr, setTempDurationStr] = useState("");
  const [durationInputUnit, setDurationInputUnit] = useState<"h" | "d">("h");
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [tempAmountStr, setTempAmountStr] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const allSupportedAssets = useMemo(() => getSupportedAssets(), []);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allSupportedAssets;
    return allSupportedAssets.filter(
      (a) =>
        a.displaySymbol.toLowerCase().includes(q) ||
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [allSupportedAssets, searchQuery]);

  const durationDomain = useMemo(() => domainForDuration(entries), [entries]);
  const unitsDomain = useMemo(() => domainForUnits(entries), [entries]);

  const xScale = useMemo(() => makeLogScale(durationDomain, PLOT_LEFT, PLOT_RIGHT), [durationDomain]);
  const yScale = useMemo(() => makeLinearScale(unitsDomain, PLOT_BOTTOM, PLOT_TOP), [unitsDomain]);

  const stats = useMemo(() => computeStats(entries, consumedByHash, duration), [entries, consumedByHash, duration]);

  const allocation = useMemo(
    () => (duration > 0 && desiredUnits > 0n ? allocate(entries, consumedByHash, desiredUnits, duration, 0) : null),
    [entries, consumedByHash, desiredUnits, duration],
  );

  const allocatedMap = useMemo(() => {
    const map = new Map<Hex, bigint>();
    if (allocation) {
      for (const row of allocation.rows) {
        map.set(row.entry.hash, row.units);
      }
    }
    return map;
  }, [allocation]);

  const rankMap = useMemo(() => {
    const map = new Map<Hex, number>();
    if (allocation) {
      allocation.rows.forEach((row, i) => {
        map.set(row.entry.hash, i + 1);
      });
    }
    return map;
  }, [allocation]);

  const depthPath = useMemo(() => {
    const samples = logSamplePoints(durationDomain, DEPTH_SAMPLES);
    const ranges = entries.map((e) => ({
      lo: e.data.minHours,
      hi: e.data.maxHours,
      weight: Number(remainingUnits(e, consumedByHash)),
    }));
    const totals = rangeDepthCurve(ranges, samples);
    const top = samples.map((h, i) => `${xScale.scale(h)},${yScale.scale(totals[i])}`).join(" L ");
    const baseline = yScale.scale(0);
    return {
      line: `M ${top}`,
      area: `M ${xScale.scale(samples[0])},${baseline} L ${top} L ${xScale.scale(samples[samples.length - 1])},${baseline} Z`,
    };
  }, [entries, consumedByHash, durationDomain, xScale, yScale]);

  function localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function applyDrag(target: DragTarget, p: { x: number; y: number }) {
    if (target === "duration" || target === "center") {
      const d = Math.round(xScale.invert(clamp(p.x, PLOT_LEFT, PLOT_RIGHT)));
      onDurationChange(clamp(d, durationDomain[0], durationDomain[1]));
    }
    if (target === "units" || target === "center") {
      const u = Math.round(yScale.invert(clamp(p.y, PLOT_TOP, PLOT_BOTTOM)));
      onDesiredUnitsChange(BigInt(clamp(u, 0, unitsDomain[1])));
    }
  }

  function onUnitsPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag("units");
    applyDrag("units", localPoint(e));
  }

  function onDurationPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag("duration");
    applyDrag("duration", localPoint(e));
  }

  function onCenterPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag("center");
    applyDrag("center", localPoint(e));
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    applyDrag(drag, localPoint(e));
  }

  function onPointerUp() {
    setDrag(null);
  }

  const unitsStep = Math.max(1, Math.round(unitsDomain[1] / 100));
  function onUnitsKeyDown(e: React.KeyboardEvent) {
    const cur = Number(desiredUnits);
    if (e.key === "ArrowUp" || e.key === "ArrowRight") onDesiredUnitsChange(BigInt(clamp(cur + unitsStep, 0, unitsDomain[1])));
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") onDesiredUnitsChange(BigInt(clamp(cur - unitsStep, 0, unitsDomain[1])));
    else if (e.key === "Home") onDesiredUnitsChange(0n);
    else if (e.key === "End") onDesiredUnitsChange(BigInt(unitsDomain[1]));
    else return;
    e.preventDefault();
  }

  function onDurationKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onDurationChange(clamp(duration + step, durationDomain[0], durationDomain[1]));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onDurationChange(clamp(duration - step, durationDomain[0], durationDomain[1]));
    else if (e.key === "Home") onDurationChange(durationDomain[0]);
    else if (e.key === "End") onDurationChange(durationDomain[1]);
    else return;
    e.preventDefault();
  }

  function startDurationEdit() {
    if (duration >= 24) {
      setDurationInputUnit("d");
      const d = duration / 24;
      setTempDurationStr(duration % 24 === 0 ? d.toString() : d.toFixed(1));
    } else {
      setDurationInputUnit("h");
      setTempDurationStr(duration.toString());
    }
    setIsEditingDuration(true);
  }

  function switchDurationUnit(newUnit: "h" | "d") {
    if (newUnit === durationInputUnit) return;
    const currentVal = parseFloat(tempDurationStr);
    if (!isNaN(currentVal) && currentVal > 0) {
      if (newUnit === "d") {
        const d = currentVal / 24;
        setTempDurationStr(currentVal % 24 === 0 ? d.toString() : d.toFixed(1));
      } else {
        setTempDurationStr(Math.round(currentVal * 24).toString());
      }
    }
    setDurationInputUnit(newUnit);
  }

  function submitDurationEdit() {
    setIsEditingDuration(false);
    if (durationInputUnit === "d") {
      const parsed = parseFloat(tempDurationStr);
      if (!isNaN(parsed) && parsed > 0) {
        onDurationChange(clamp(Math.round(parsed * 24), durationDomain[0], durationDomain[1]));
      }
    } else {
      const parsed = parseDuration(tempDurationStr, duration);
      onDurationChange(clamp(parsed, durationDomain[0], durationDomain[1]));
    }
  }

  function submitAmountEdit() {
    setIsEditingAmount(false);
    const parsed = parseFloat(tempAmountStr);
    if (!isNaN(parsed) && parsed >= 0) {
      onDesiredUnitsChange(assetToUnits(parsed));
    }
  }

  function handleSelectEntry(entry: MarketEntry) {
    setSelectedEntry(entry);
    onSelectEntry?.(entry);
  }

  const durationHandleX = xScale.scale(clamp(duration, durationDomain[0], durationDomain[1]));
  const unitsHandleY = yScale.scale(clamp(Number(desiredUnits), 0, unitsDomain[1]));

  const activeAssetSymbol = assetDisplaySymbol(selectedAsset);

  const isUnitsActive = drag === "units" || hoverUnitsHandle || drag === "center" || hoverCenterHandle;
  const isDurationActive = drag === "duration" || hoverDurationHandle || drag === "center" || hoverCenterHandle;
  const isCenterActive = drag === "center" || hoverCenterHandle;
  const hasLiquidity = entries.length > 0 && stats.totalCapacity > 0;

  // Cartesian intersection target point coordinates
  const targetPointX = durationHandleX;
  const targetPointY = unitsHandleY;

  return (
    <div className="flex flex-col gap-3">
      {/* Searchable Asset Selection Bar directly above chart */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--surface-raised)] p-2.5 rounded-xl border border-[var(--border)] shadow-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs uppercase tracking-wider text-[var(--foreground)]">Asset</span>
          <InfoTooltip content="Select underlying collateral asset to inspect active market depth and available LP profiles." size={12} />
        </div>

        {/* Central Searchable Asset Tabs */}
        <div className="flex flex-1 items-center justify-center gap-1.5 min-w-[200px] overflow-x-auto py-0.5">
          <div role="tablist" aria-label="Underlying Asset Selection" className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-inner">
            {filteredAssets.length > 0 ? (
              filteredAssets.map((asset) => {
                const active = selectedAsset.toLowerCase() === asset.address.toLowerCase();
                return (
                  <Tooltip key={asset.address} content={`Trade ${asset.name} (${asset.displaySymbol}) options contracts`}>
                    <button
                      role="tab"
                      aria-selected={active}
                      type="button"
                      onClick={() => onSelectAsset?.(asset.address)}
                      className={`min-h-[32px] rounded-lg px-3.5 py-1 text-xs font-bold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
                        active
                          ? "bg-[var(--base-blue)] text-white shadow-xs font-extrabold ring-1 ring-[var(--base-blue-light)]/40"
                          : "text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-overlay)]"
                      }`}
                    >
                      {asset.displaySymbol}
                    </button>
                  </Tooltip>
                );
              })
            ) : (
              <span className="px-3 py-1 text-xs text-[var(--text-muted)] italic">
                No matching assets found
              </span>
            )}
          </div>
        </div>

        {/* Real-time Asset Search Input */}
        <div className="relative flex items-center min-w-[150px] sm:min-w-[180px]">
          <span className="absolute left-2.5 text-[var(--text-muted)] pointer-events-none">
            <SearchIcon size={13} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search assets..."
            aria-label="Search available assets"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-7 py-1 text-xs text-[var(--foreground)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--base-blue)] focus:ring-1 focus:ring-[var(--base-blue)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear asset search"
              className="absolute right-2 text-[var(--text-muted)] hover:text-[var(--foreground)] cursor-pointer text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Sleek Axis Controls, Depth Stats & Legend Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] p-2.5 rounded-xl border border-[var(--border)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[var(--foreground)]">Duration:</span>
            {isEditingDuration ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step={durationInputUnit === "d" ? "0.1" : "1"}
                  min={durationInputUnit === "d" ? (durationDomain[0] / 24).toFixed(1) : durationDomain[0]}
                  max={durationInputUnit === "d" ? (durationDomain[1] / 24).toFixed(1) : durationDomain[1]}
                  value={tempDurationStr}
                  onChange={(e) => setTempDurationStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitDurationEdit();
                    if (e.key === "Escape") setIsEditingDuration(false);
                  }}
                  onBlur={submitDurationEdit}
                  autoFocus
                  aria-label="Duration value"
                  className="w-16 rounded-lg border border-[var(--base-blue)] bg-[var(--surface-overlay)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--foreground)] outline-none ring-1 ring-[var(--base-blue)]"
                />
                <div role="group" aria-label="Duration unit" className="flex rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5">
                  <button
                    type="button"
                    onClick={() => switchDurationUnit("h")}
                    className={`px-1.5 py-0.5 text-xs font-bold rounded cursor-pointer transition-colors ${
                      durationInputUnit === "h"
                        ? "bg-[var(--base-blue)] text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    h
                  </button>
                  <button
                    type="button"
                    onClick={() => switchDurationUnit("d")}
                    className={`px-1.5 py-0.5 text-xs font-bold rounded cursor-pointer transition-colors ${
                      durationInputUnit === "d"
                        ? "bg-[var(--base-blue)] text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    d
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={startDurationEdit}
                className="group inline-flex min-h-[28px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-mono font-bold tabular-nums text-[var(--foreground)] transition-all hover:bg-[var(--surface-overlay)] hover:border-[var(--base-blue)] hover:text-[var(--base-blue-light)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                title="Click to edit duration (hours or days)"
              >
                <span>{formatDuration(duration)}</span>
                {duration >= 24 && (
                  <span className="text-xs font-normal text-[var(--text-muted)] group-hover:text-[var(--base-blue-light)] transition-colors">
                    ({duration}h)
                  </span>
                )}
                <span className="text-xs text-[var(--base-blue-light)] opacity-70 group-hover:opacity-100 transition-opacity">
                  <EditIcon size={12} />
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[var(--foreground)]">Amount:</span>
            {isEditingAmount ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tempAmountStr}
                  onChange={(e) => setTempAmountStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitAmountEdit();
                    if (e.key === "Escape") setIsEditingAmount(false);
                  }}
                  onBlur={submitAmountEdit}
                  autoFocus
                  aria-label="Desired amount"
                  className="w-24 rounded-lg border border-[var(--base-blue)] bg-[var(--surface-overlay)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--foreground)] outline-none ring-1 ring-[var(--base-blue)]"
                />
                <span className="font-mono text-xs font-bold">{activeAssetSymbol}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTempAmountStr(unitsToAsset(desiredUnits).toString());
                  setIsEditingAmount(true);
                }}
                className="group inline-flex min-h-[28px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-mono font-bold tabular-nums text-[var(--foreground)] transition-all hover:bg-[var(--surface-overlay)] hover:border-[var(--base-blue)] hover:text-[var(--base-blue-light)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                title="Click to edit amount"
              >
                <span>{formatAsset(desiredUnits, activeAssetSymbol)}</span>
                <span className="text-xs text-[var(--base-blue-light)] opacity-70 group-hover:opacity-100 transition-opacity">
                  <EditIcon size={12} />
                </span>
              </button>
            )}
          </div>

          <span className="hidden sm:inline-block h-3.5 w-px bg-[var(--border)]" />

          <div className="hidden md:flex items-center gap-2 text-xs">
            <span className="text-[var(--text-muted)]">Available Depth:</span>
            <span className="font-mono font-bold text-[var(--base-blue-light)]">
              {formatAsset(stats.eligibleCapacity, activeAssetSymbol)}
            </span>
          </div>
        </div>

        {/* Visual Matrix Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-xs border-2 border-[var(--base-blue)] bg-[var(--base-blue)]/50 shadow-xs" />
            <strong className="text-[var(--foreground)]">Matched Source</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-xs border border-[var(--border-strong)] bg-[var(--surface-overlay)]" />
            <span>Available Pool</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--base-blue)] ring-2 ring-[var(--base-blue-light)]" />
            <span className="font-semibold text-[var(--base-blue-light)]">Target Point</span>
          </span>
        </div>
      </div>

      {/* 2D SVG Liquidity Matrix Plot */}
      <div className="relative rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 shadow-inner">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full touch-none select-none"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="2D Liquidity Matrix Chart"
        >
          <defs>
            {/* High-visibility Selection Glow Filter */}
            <filter id="selectionGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="var(--base-blue)" floodOpacity="1" />
              <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="var(--base-blue-light)" floodOpacity="0.8" />
            </filter>
            <filter id="targetPointGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#000000" floodOpacity="0.6" />
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="var(--base-blue)" floodOpacity="1" />
              <feDropShadow dx="0" dy="0" stdDeviation="12" floodColor="var(--base-blue-light)" floodOpacity="0.9" />
            </filter>
            <filter id="targetBadgeShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#000000" floodOpacity="0.5" />
            </filter>
            <filter id="handleGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="var(--base-blue)" floodOpacity="0.9" />
            </filter>
            <filter id="handleGlowActive" x="-150%" y="-150%" width="400%" height="400%">
              <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="var(--base-blue)" floodOpacity="1" />
              <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor="var(--base-blue-light)" floodOpacity="0.8" />
            </filter>
            <linearGradient id="depthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--base-blue-light)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--base-blue-light)" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="targetAreaGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--base-blue)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--base-blue)" stopOpacity="0.01" />
            </linearGradient>
            <pattern id="allocatedHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="8" stroke="var(--base-blue-light)" strokeWidth="2.5" strokeOpacity="0.6" />
            </pattern>
          </defs>

          <Gridlines xScale={xScale} yScale={yScale} durationDomain={durationDomain} unitsDomain={unitsDomain} />

          {/* Empty State / No Liquidity Message */}
          {!hasLiquidity && (
            <g pointerEvents="none">
              <rect
                x={(PLOT_LEFT + PLOT_RIGHT) / 2 - 60}
                y={(PLOT_TOP + PLOT_BOTTOM) / 2 - 15}
                width={120}
                height={30}
                rx={6}
                fill="var(--surface)"
                stroke="var(--border)"
                strokeWidth={1}
                fillOpacity={0.9}
              />
              <text
                x={(PLOT_LEFT + PLOT_RIGHT) / 2}
                y={(PLOT_TOP + PLOT_BOTTOM) / 2 + 4}
                fill="var(--text-muted)"
                fontSize={12}
                fontWeight="bold"
                textAnchor="middle"
              >
                No liquidity
              </text>
            </g>
          )}

          {/* Cumulative Depth Fill */}
          <path d={depthPath.area} fill="url(#depthFill)" pointerEvents="none" />

          {/* Shaded Cartesian Target Domain Box */}
          {duration > 0 && desiredUnits > 0n && (
            <rect
              x={PLOT_LEFT}
              y={targetPointY}
              width={Math.max(0, targetPointX - PLOT_LEFT)}
              height={Math.max(0, PLOT_BOTTOM - targetPointY)}
              fill="url(#targetAreaGradient)"
              stroke="var(--base-blue)"
              strokeOpacity={0.4}
              strokeDasharray="3 3"
              strokeWidth={1.25}
              pointerEvents="none"
            />
          )}

          {/* All Counterparty Commitment Bars */}
          {entries.map((entry) => (
            <EntryBar
              key={entry.hash}
              entry={entry}
              consumedByHash={consumedByHash}
              xScale={xScale}
              yScale={yScale}
              eligible={duration >= entry.data.minHours && duration <= entry.data.maxHours}
              allocatedUnits={allocatedMap.get(entry.hash) ?? 0n}
              rank={rankMap.get(entry.hash)}
              hovered={hover?.entry.hash === entry.hash || highlightedHash === entry.hash}
              selected={selectedEntry?.hash === entry.hash}
              onHover={(p) => setHover(p ? { entry, x: p.x, y: p.y } : null)}
              onClick={() => handleSelectEntry(entry)}
            />
          ))}

          {/* Depth curve top line */}
          <path d={depthPath.line} fill="none" stroke="var(--base-blue-light)" strokeWidth={1.5} strokeOpacity={0.7} pointerEvents="none" />

          {/* High-Contrast Cartesian Coordination Crosshair Lines */}
          {duration > 0 && desiredUnits > 0n && (
            <>
              {/* Vertical Coordinate Background Contrast Glow Line */}
              <line
                x1={targetPointX}
                x2={targetPointX}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                stroke="var(--surface-raised)"
                strokeOpacity={0.9}
                strokeWidth={3.5}
                pointerEvents="none"
              />
              {/* Vertical Coordinate Line */}
              <line
                x1={targetPointX}
                x2={targetPointX}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                stroke="var(--base-blue-light)"
                strokeOpacity={1}
                strokeDasharray="5 4"
                strokeWidth={1.75}
                pointerEvents="none"
              />
              {/* Horizontal Coordinate Background Contrast Glow Line */}
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={targetPointY}
                y2={targetPointY}
                stroke="var(--surface-raised)"
                strokeOpacity={0.9}
                strokeWidth={3.5}
                pointerEvents="none"
              />
              {/* Horizontal Coordinate Line */}
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={targetPointY}
                y2={targetPointY}
                stroke="var(--base-blue-light)"
                strokeOpacity={1}
                strokeDasharray="5 4"
                strokeWidth={1.75}
                pointerEvents="none"
              />

              {/* Cartesian Target Intersection Point Marker on the Chart (Interactive & Draggable) */}
              <g
                tabIndex={0}
                role="slider"
                aria-label="Target liquidity selection point"
                aria-valuetext={`${formatAsset(desiredUnits, activeAssetSymbol)} at ${formatDurationFull(duration)}`}
                onPointerDown={onCenterPointerDown}
                onPointerEnter={() => setHoverCenterHandle(true)}
                onPointerLeave={() => setHoverCenterHandle(false)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") onUnitsKeyDown(e);
                  else if (e.key === "ArrowLeft" || e.key === "ArrowRight") onDurationKeyDown(e);
                }}
                className="cursor-grab active:cursor-grabbing focus:outline-none"
              >
                {/* Expanded invisible hit target area for effortless grabbing */}
                <circle
                  cx={targetPointX}
                  cy={targetPointY}
                  r={24}
                  fill="transparent"
                />
                {/* Outer halo circle */}
                <circle
                  cx={targetPointX}
                  cy={targetPointY}
                  r={isCenterActive ? 18 : 13}
                  fill="var(--base-blue-faint)"
                  stroke="var(--base-blue-light)"
                  strokeWidth={isCenterActive ? 2.5 : 2}
                  className="transition-all duration-150 ease-out pointer-events-none"
                />
                {/* Core target disc with high-contrast border */}
                <circle
                  cx={targetPointX}
                  cy={targetPointY}
                  r={isCenterActive ? 9 : 7}
                  fill="var(--base-blue)"
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  filter="url(#targetPointGlow)"
                  className="transition-all duration-150 ease-out pointer-events-none"
                />
                {/* Center white bullseye dot */}
                <circle
                  cx={targetPointX}
                  cy={targetPointY}
                  r={isCenterActive ? 3.5 : 2.5}
                  fill="#ffffff"
                  className="pointer-events-none"
                />

                {/* Floating Cartesian Target Coordinate Badge with high contrast */}
                {(() => {
                  const badgeWidth = 156;
                  const badgeHeight = 28;
                  const badgeX = clamp(targetPointX - badgeWidth / 2, PLOT_LEFT + 8, PLOT_RIGHT - badgeWidth - 8);
                  const badgeY = targetPointY > PLOT_TOP + 40 ? targetPointY - 36 : targetPointY + 14;

                  return (
                    <g transform={`translate(${badgeX}, ${badgeY})`} filter="url(#targetBadgeShadow)" className="pointer-events-none">
                      <rect
                        width={badgeWidth}
                        height={badgeHeight}
                        rx={6}
                        fill="var(--surface-raised)"
                        stroke="var(--base-blue)"
                        strokeWidth={1.75}
                        className="transition-colors duration-150"
                      />
                      <circle cx={14} cy={badgeHeight / 2} r={4} fill="var(--base-blue)" />
                      <circle cx={14} cy={badgeHeight / 2} r={2} fill="#ffffff" />
                      <text
                        x={24}
                        y={badgeHeight / 2 + 4}
                        fill="var(--foreground)"
                        fontSize={11}
                        fontWeight="bold"
                        className="font-mono tabular-nums"
                      >
                        {formatAsset(desiredUnits, activeAssetSymbol)} @ {formatDuration(duration)}
                      </text>
                    </g>
                  );
                })()}
              </g>
            </>
          )}

          {/* Reference projection lines to outer slider tracks */}
          <line
            x1={durationHandleX}
            x2={durationHandleX}
            y1={PLOT_BOTTOM}
            y2={DURATION_TRACK_Y}
            stroke="var(--base-blue)"
            strokeOpacity={0.6}
            strokeDasharray="2 2"
            strokeWidth={1.5}
            pointerEvents="none"
          />
          <line
            x1={UNITS_TRACK_X}
            x2={PLOT_LEFT}
            y1={unitsHandleY}
            y2={unitsHandleY}
            stroke="var(--base-blue)"
            strokeOpacity={0.6}
            strokeDasharray="2 2"
            strokeWidth={1.5}
            pointerEvents="none"
          />

          {/* Vertical Slider Track & Handle (Amount) */}
          <line x1={UNITS_TRACK_X} x2={UNITS_TRACK_X} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke={isUnitsActive ? "var(--base-blue)" : "var(--border-hover)"} strokeWidth={isUnitsActive ? 3 : 2} />
          <rect
            x={UNITS_TRACK_X - 18}
            y={PLOT_TOP}
            width={36}
            height={PLOT_HEIGHT}
            fill="transparent"
            className="cursor-ns-resize focus:outline-none"
            tabIndex={0}
            role="slider"
            aria-label="Desired amount in underlying asset"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={unitsDomain[1]}
            aria-valuenow={Number(desiredUnits)}
            onPointerDown={onUnitsPointerDown}
            onPointerEnter={() => setHoverUnitsHandle(true)}
            onPointerLeave={() => setHoverUnitsHandle(false)}
            onKeyDown={onUnitsKeyDown}
          />
          <circle
            cx={UNITS_TRACK_X}
            cy={unitsHandleY}
            r={isUnitsActive ? 14 : 9}
            fill="var(--base-blue)"
            stroke="#ffffff"
            strokeWidth={2.5}
            filter={isUnitsActive ? "url(#handleGlowActive)" : "url(#handleGlow)"}
            className="pointer-events-none transition-all duration-150 ease-out"
          />
          <circle
            cx={UNITS_TRACK_X}
            cy={unitsHandleY}
            r={isUnitsActive ? 3.5 : 2}
            fill="#ffffff"
            className="pointer-events-none"
          />

          {/* Floating badge tooltip while dragging vertical handle */}
          {isUnitsActive && (
            <g transform={`translate(${UNITS_TRACK_X + 18}, ${unitsHandleY - 14})`} pointerEvents="none">
              <rect width={96} height={28} rx={6} fill="var(--base-blue)" />
              <text x={48} y={18} fill="#ffffff" fontSize={11} fontWeight="bold" textAnchor="middle" className="font-mono tabular-nums">
                {formatAsset(desiredUnits, activeAssetSymbol)}
              </text>
            </g>
          )}

          {/* Horizontal Slider Track & Handle (Duration) */}
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={DURATION_TRACK_Y} y2={DURATION_TRACK_Y} stroke={isDurationActive ? "var(--base-blue)" : "var(--border-hover)"} strokeWidth={isDurationActive ? 3 : 2} />
          <rect
            x={PLOT_LEFT}
            y={DURATION_TRACK_Y - 18}
            width={PLOT_WIDTH}
            height={36}
            fill="transparent"
            className="cursor-ew-resize focus:outline-none"
            tabIndex={0}
            role="slider"
            aria-label="Duration in hours"
            aria-orientation="horizontal"
            aria-valuemin={durationDomain[0]}
            aria-valuemax={durationDomain[1]}
            aria-valuenow={duration}
            onPointerDown={onDurationPointerDown}
            onPointerEnter={() => setHoverDurationHandle(true)}
            onPointerLeave={() => setHoverDurationHandle(false)}
            onKeyDown={onDurationKeyDown}
          />
          <circle
            cx={durationHandleX}
            cy={DURATION_TRACK_Y}
            r={isDurationActive ? 14 : 9}
            fill="var(--base-blue)"
            stroke="#ffffff"
            strokeWidth={2.5}
            filter={isDurationActive ? "url(#handleGlowActive)" : "url(#handleGlow)"}
            className="pointer-events-none transition-all duration-150 ease-out"
          />
          <circle
            cx={durationHandleX}
            cy={DURATION_TRACK_Y}
            r={isDurationActive ? 3.5 : 2}
            fill="#ffffff"
            className="pointer-events-none"
          />

          {/* Floating badge tooltip while dragging horizontal handle */}
          {isDurationActive && (
            <g
              transform={`translate(${durationHandleX - (duration >= 24 ? 44 : 28)}, ${DURATION_TRACK_Y + 24})`}
              pointerEvents="none"
              className="transition-all duration-75 ease-out"
            >
              <rect width={duration >= 24 ? 88 : 56} height={26} rx={6} fill="var(--base-blue)" />
              <text x={duration >= 24 ? 44 : 28} y={17} fill="var(--text-on-action)" fontSize={11} fontWeight="bold" textAnchor="middle" className="font-mono tabular-nums">
                {formatDurationFull(duration)}
              </text>
            </g>
          )}
        </svg>

        {/* Rich Counterparty Hover Card */}
        {hover && (
          <div
            className="pointer-events-none absolute z-20 min-w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3.5 text-xs text-[var(--foreground)] shadow-2xl backdrop-blur-md transition-all duration-75"
            style={(() => {
              const isTopHalf = hover.y < 200;
              const isLeftEdge = hover.x < 140;
              const isRightEdge = hover.x > WIDTH - 140;

              const transformX = isLeftEdge ? "0%" : isRightEdge ? "-100%" : "-50%";
              const transformY = isTopHalf ? "0.75rem" : "calc(-100% - 0.75rem)";

              return {
                left: `${Math.min(Math.max((hover.x / WIDTH) * 100, 3), 97)}%`,
                top: `${(hover.y / HEIGHT) * 100}%`,
                transform: `translate(${transformX}, ${transformY})`,
              };
            })()}
          >
            {(() => {
              const cp = getCounterparty(entryProvider(hover.entry));
              const isAllocated = allocatedMap.has(hover.entry.hash);
              const rank = rankMap.get(hover.entry.hash);
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
                    <div>
                      <div className="font-bold text-[var(--foreground)] flex items-center gap-1.5">
                        {isAllocated && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--base-blue)] text-xs font-bold text-white">
                            #{rank}
                          </span>
                        )}
                        {cp.name}
                      </div>
                      <div className="font-mono text-xs text-[var(--text-muted)]">{cp.shortName}</div>
                    </div>
                    <Badge tone={cp.tone || (hover.entry.kind === "profile" ? "blue" : "cyan")}>
                      {cp.tag || (hover.entry.kind === "profile" ? "Solo LP" : "Router MM")}
                    </Badge>
                  </div>

                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--text-muted)]">Duration Coverage</span>
                      <span className="font-mono font-semibold">
                        {formatDuration(hover.entry.data.minHours)} – {formatDuration(hover.entry.data.maxHours)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--text-muted)]">Asking Rate</span>
                      <span className="font-mono font-semibold text-[var(--base-blue-light)]">
                        ${entryHumanRate(hover.entry).toLocaleString(undefined, { maximumFractionDigits: 4 })}/hr
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--text-muted)]">Remaining Capacity</span>
                      <span className="font-mono font-semibold text-[var(--foreground)]">
                        {formatAsset(remainingUnits(hover.entry, consumedByHash), assetDisplaySymbol(hover.entry.data.collateralAsset))}
                      </span>
                    </div>
                  </div>

                  {isAllocated && (
                    <div className="mt-1 flex items-center justify-between rounded-lg bg-[var(--base-blue-faint)] px-2.5 py-1.5 text-xs font-bold text-[var(--base-blue-light)] border border-[var(--base-blue-muted)]">
                      <span className="flex items-center gap-1">
                        <CheckIcon size={12} />
                        Active Allocation
                      </span>
                      <span>
                        {formatAsset(allocatedMap.get(hover.entry.hash)!, assetDisplaySymbol(hover.entry.data.collateralAsset))}
                      </span>
                    </div>
                  )}

                  <div className="text-xs text-[var(--text-muted)] italic pt-0.5">
                    Click box to inspect counterparty terms
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Selected Counterparty Details Modal / Drawer */}
        {selectedEntry && (
          <div className="mt-3 rounded-xl border border-[var(--base-blue)] bg-[var(--surface-raised)] p-4 text-xs text-[var(--foreground)] animate-in fade-in slide-in-from-bottom-2 duration-150">
            {(() => {
              const cp = getCounterparty(entryProvider(selectedEntry));
              const remaining = remainingUnits(selectedEntry, consumedByHash);
              const rate = entryHumanRate(selectedEntry);
              return (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--base-blue)]" />
                      <span className="font-bold text-sm text-[var(--foreground)]">
                        {cp.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedEntry(null)}
                      className="rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-overlay)] transition-colors cursor-pointer"
                      title="Close"
                    >
                      <CloseIcon size={16} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                      <div className="text-xs font-bold uppercase text-[var(--text-muted)]">Type</div>
                      <div className="mt-0.5 font-semibold text-xs text-[var(--foreground)]">{cp.tag}</div>
                    </div>

                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                      <div className="text-xs font-bold uppercase text-[var(--text-muted)]">Range</div>
                      <div className="mt-0.5 font-semibold text-xs text-[var(--foreground)] font-mono">
                        {formatDuration(selectedEntry.data.minHours)}–{formatDuration(selectedEntry.data.maxHours)}
                      </div>
                    </div>

                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                      <div className="text-xs font-bold uppercase text-[var(--text-muted)]">Available</div>
                      <div className="mt-0.5 font-semibold text-xs text-[var(--foreground)] font-mono">
                        {formatAsset(remaining, assetDisplaySymbol(selectedEntry.data.collateralAsset))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                      <div className="text-xs font-bold uppercase text-[var(--text-muted)]">Rate</div>
                      <div className="mt-0.5 font-semibold text-xs text-[var(--base-blue-light)] font-mono">
                        ${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}/hr
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        onDurationChange(selectedEntry.data.maxHours);
                        onDesiredUnitsChange(remaining);
                      }}
                      className="rounded-lg bg-[var(--base-blue)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--base-blue-light)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                    >
                      Snap Target
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Surfaced Matched Liquidity Sources Panel */}
      {allocation && allocation.rows.length > 0 && (
        <div className="rounded-xl border border-[var(--base-blue-muted)] bg-[var(--surface-raised)] p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-[var(--base-blue)] animate-pulse" />
              <span className="font-bold text-xs text-[var(--foreground)]">
                Matched Liquidity Sources ({allocation.rows.length})
              </span>
              <span className="rounded-md bg-[var(--base-blue-faint)] px-2 py-0.5 text-xs font-bold text-[var(--base-blue-light)] border border-[var(--base-blue-muted)]">
                {Number(allocation.totalUnits) >= Number(desiredUnits) ? "100% Filled" : `${Math.round((Number(allocation.totalUnits) / Number(desiredUnits || 1n)) * 100)}% Filled`}
              </span>
            </div>
            <div className="text-xs font-mono text-[var(--text-muted)]">
              Total: <strong className="text-[var(--foreground)]">{formatAsset(allocation.totalUnits, activeAssetSymbol)}</strong>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {allocation.rows.map((row, idx) => {
              const cp = getCounterparty(entryProvider(row.entry));
              const isItemHovered = highlightedHash === row.entry.hash || hover?.entry.hash === row.entry.hash;
              const isItemSelected = selectedEntry?.hash === row.entry.hash;
              const isItemActive = isItemHovered || isItemSelected;
              const sharePct = desiredUnits > 0n ? Math.round((Number(row.units) / Number(desiredUnits)) * 100) : 100;

              return (
                <button
                  key={row.entry.hash}
                  type="button"
                  onMouseEnter={() => setHighlightedHash(row.entry.hash)}
                  onMouseLeave={() => setHighlightedHash(null)}
                  onClick={() => handleSelectEntry(row.entry)}
                  className={`flex flex-col gap-1.5 rounded-lg p-2.5 text-left transition-all cursor-pointer ${
                    isItemActive
                      ? "border-2 border-[var(--base-blue)] bg-[var(--base-blue-faint)] shadow-sm ring-2 ring-[var(--base-blue-light)]/40 scale-[1.01]"
                      : "border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--base-blue-muted)] hover:bg-[var(--surface-overlay)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--base-blue)] text-[10px] font-bold text-white">
                        #{idx + 1}
                      </span>
                      <span className="font-bold text-xs text-[var(--foreground)] truncate">
                        {cp.name}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold border ${
                        cp.tag && (cp.tag.includes("v4") || cp.tag.includes("Uniswap"))
                          ? "bg-[var(--purple-faint,rgba(168,85,247,0.1))] text-[var(--purple-text,#c084fc)] border-[var(--purple-border,rgba(168,85,247,0.3))]"
                          : "bg-[var(--surface-overlay)] text-[var(--text-muted)] border-[var(--border)]"
                      }`}
                    >
                      {cp.tag || (row.entry.kind === "profile" ? "Solo LP" : "Router MM")}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-[var(--base-blue-light)]">
                      {formatAsset(row.units, activeAssetSymbol)} <span className="text-[10px] text-[var(--text-muted)] font-normal">({sharePct}%)</span>
                    </span>
                    <span className="text-[var(--text-muted)]">
                      ${entryHumanRate(row.entry).toLocaleString(undefined, { maximumFractionDigits: 4 })}/hr
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
                    <span className="flex items-center gap-1">
                      <span>Source:</span>
                      <a
                        href={`https://basescan.org/address/${entryProvider(row.entry)}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[var(--base-blue-light)] hover:underline"
                        title="View contract on BaseScan"
                      >
                        {entryProvider(row.entry).slice(0, 6)}...{entryProvider(row.entry).slice(-4)} ↗
                      </a>
                    </span>
                    {cp.tag && cp.tag.includes("v4") && (
                      <span className="text-[#c084fc] font-semibold text-[10px]">
                        v4 Ticks [600, 1200]
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function computeStats(entries: MarketEntry[], consumedByHash: Record<Hex, bigint>, duration: number) {
  let totalCapacity = 0;
  let weightedPrice = 0;
  let eligibleCapacity = 0;
  let eligibleCount = 0;
  for (const e of entries) {
    const remaining = Number(remainingUnits(e, consumedByHash));
    totalCapacity += remaining;
    weightedPrice += remaining * entryHumanRate(e);
    if (duration >= e.data.minHours && duration <= e.data.maxHours) {
      eligibleCapacity += remaining;
      eligibleCount++;
    }
  }
  return {
    count: entries.length,
    totalCapacity,
    avgPrice: totalCapacity > 0 ? weightedPrice / totalCapacity : 0,
    eligibleCapacity,
    eligibleCount,
  };
}

function EntryBar({
  entry,
  consumedByHash,
  xScale,
  yScale,
  eligible,
  allocatedUnits,
  rank,
  hovered,
  selected,
  onHover,
  onClick,
}: {
  entry: MarketEntry;
  consumedByHash: Record<Hex, bigint>;
  xScale: Scale;
  yScale: Scale;
  eligible: boolean;
  allocatedUnits: bigint;
  rank?: number;
  hovered: boolean;
  selected: boolean;
  onHover: (p: { x: number; y: number } | null) => void;
  onClick: () => void;
}) {
  const remaining = remainingUnits(entry, consumedByHash);

  const x1 = xScale.scale(entry.data.minHours);
  const x2 = xScale.scale(entry.data.maxHours);
  const yTop = yScale.scale(Number(remaining));
  const yBase = yScale.scale(0);

  const x = Math.min(x1, x2);
  const y = Math.min(yTop, yBase);
  const width = Math.max(Math.abs(x2 - x1), MIN_RECT_WIDTH);
  const height = Math.max(Math.abs(yBase - yTop), 2);

  const isAllocated = allocatedUnits > 0n;

  // Fraction of this specific counterparty commitment consumed by taker order
  const allocatedHeight = isAllocated
    ? Math.max(3, height * (Number(allocatedUnits) / Number(remaining || 1n)))
    : 0;

  return (
    <g onClick={onClick} className="cursor-pointer">
      {/* Base Counterparty Commitment Rect */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={isAllocated ? "var(--base-blue)" : hovered || selected ? "var(--base-blue-light)" : "var(--surface-overlay)"}
        fillOpacity={
          hovered || selected
            ? 0.7
            : isAllocated
            ? 0.26
            : 0.03
        }
        stroke={
          isAllocated
            ? "var(--base-blue)"
            : selected || hovered
            ? "var(--base-blue-light)"
            : eligible
            ? "var(--border-strong)"
            : "var(--border)"
        }
        strokeOpacity={isAllocated || selected || hovered ? 1 : eligible ? 0.45 : 0.2}
        strokeWidth={isAllocated || selected || hovered ? 2.5 : 1}
        strokeDasharray={entry.kind === "quote" && !isAllocated && !hovered && !selected ? "3 3" : undefined}
        filter={isAllocated || hovered || selected ? "url(#selectionGlow)" : undefined}
        rx={3}
        onPointerEnter={() => onHover({ x: x + width / 2, y })}
        onPointerMove={() => onHover({ x: x + width / 2, y })}
        onPointerLeave={() => onHover(null)}
        className="transition-all duration-150"
      />

      {/* Top Cap Accent Bar for Allocated, Hovered or Selected entries */}
      {(isAllocated || hovered || selected) && (
        <line
          x1={x}
          x2={x + width}
          y1={y}
          y2={y}
          stroke={isAllocated || selected || hovered ? "var(--base-blue-light)" : "var(--foreground)"}
          strokeWidth={3}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      {/* Allocated Portion Fill with Hatching */}
      {isAllocated && (
        <>
          <rect
            x={x}
            y={y + (height - allocatedHeight)}
            width={width}
            height={allocatedHeight}
            fill="var(--base-blue)"
            fillOpacity={0.65}
            rx={2}
            pointerEvents="none"
          />
          <rect
            x={x}
            y={y + (height - allocatedHeight)}
            width={width}
            height={allocatedHeight}
            fill="url(#allocatedHatch)"
            rx={2}
            pointerEvents="none"
          />
        </>
      )}

      {/* Numerical Rank Badge (#1, #2, etc.) for Allocated Counterparties */}
      {isAllocated && rank && width >= 18 && (
        <g transform={`translate(${x + 3}, ${y + 3})`} pointerEvents="none">
          <circle cx={7} cy={7} r={7} fill="var(--base-blue)" stroke="var(--text-on-action)" strokeWidth={1.2} />
          <text x={7} y={10.5} fill="var(--text-on-action)" fontSize={9} fontWeight="bold" textAnchor="middle" className="font-mono">
            {rank}
          </text>
        </g>
      )}
    </g>
  );
}

function Gridlines({
  xScale,
  yScale,
  durationDomain,
  unitsDomain,
}: {
  xScale: Scale;
  yScale: Scale;
  durationDomain: [number, number];
  unitsDomain: [number, number];
}) {
  const xTicks = logTicks(durationDomain);
  const yTicks = linearTicks(unitsDomain);
  return (
    <g>
      <rect x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} fill="var(--surface-raised)" stroke="var(--border)" rx={4} />
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={xScale.scale(t)} x2={xScale.scale(t)} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke="var(--border)" strokeOpacity={0.6} />
          <text x={xScale.scale(t)} y={PLOT_BOTTOM + 14} fill="var(--text-muted)" fontSize={10} textAnchor="middle" className="font-mono tabular-nums">
            {t < 24 ? `${t}h` : t % 24 === 0 ? `${t / 24}d` : `${t}h`}
          </text>
        </g>
      ))}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={yScale.scale(t)} y2={yScale.scale(t)} stroke="var(--border)" strokeOpacity={0.6} />
          <text x={UNITS_TRACK_X - 14} y={yScale.scale(t) + 3} fill="var(--text-muted)" fontSize={10} textAnchor="end" className="font-mono tabular-nums">
            {unitsToAsset(t).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </text>
        </g>
      ))}
      <text x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={HEIGHT - 8} fill="var(--text-muted)" fontSize={11} textAnchor="middle" className="font-medium">
        Hours
      </text>
      <text
        x={20}
        y={(PLOT_TOP + PLOT_BOTTOM) / 2}
        fill="var(--text-muted)"
        fontSize={11}
        textAnchor="middle"
        className="font-medium"
        transform={`rotate(-90 20 ${(PLOT_TOP + PLOT_BOTTOM) / 2})`}
      >
        Amount
      </text>
    </g>
  );
}

function domainForDuration(entries: MarketEntry[]): [number, number] {
  if (entries.length === 0) return [1, 8760];
  let minH = Infinity;
  let maxH = -Infinity;
  for (const e of entries) {
    minH = Math.min(minH, e.data.minHours);
    maxH = Math.max(maxH, e.data.maxHours);
  }
  return [Math.max(1, minH), Math.max(maxH, minH + 1)];
}

function domainForUnits(entries: MarketEntry[]): [number, number] {
  if (entries.length === 0) return [0, 100];
  let maxCap = 0;
  for (const e of entries) {
    const cap = Number(entryCapacity(e));
    if (cap > maxCap) maxCap = cap;
  }
  return [0, Math.max(maxCap, 1)];
}
