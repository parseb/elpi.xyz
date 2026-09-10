"use client";

import { useEffect, useMemo, useState } from "react";
import { usePublicClient, useReadContracts } from "wagmi";
import { parseEventLogs, type Hex } from "viem";
import { addresses } from "@/config/addresses";
import { PositionManagerAbi } from "@/generated/abis/PositionManager";
import { LPRouterAbi } from "@/generated/abis/LPRouter";
import { listProfiles } from "@/lib/profileStore";
import { listQuotes } from "@/lib/quoteStore";
import type { SignedLiquidityProfile } from "@/lib/liquidityProfile";
import type { SignedBackerQuote } from "@/lib/backerQuote";
import { assetSymbol } from "@/lib/assetLabels";
import { buildMarketEntries, entryHumanRate, entryProvider, remainingUnits } from "@/lib/market";
import { computeProtocolStats, isRouterBacked, type MintRecord } from "@/lib/analytics";
import { formatDuration, histogram, makeLinearScale, marketPriceColor, PRICE_DOMAIN, type Scale } from "@/lib/charts";
import { isDev } from "@/config/chain";
import { Badge, Card, ErrorBanner, InfoTooltip, PageHeader, StatTile, Tooltip } from "@/components/ui";

const ASSETS = [addresses.collateralAsset, addresses.wbtcAsset, addresses.nvdaAsset] as const;
const DURATION_BUCKETS = [
  { label: "1-24h", lo: 1, hi: 24 },
  { label: "1-7d", lo: 24, hi: 168 },
  { label: "7-30d", lo: 168, hi: 720 },
  { label: "30-90d", lo: 720, hi: 2160 },
  { label: "90-180d", lo: 2160, hi: 4320 },
  { label: "180-365d", lo: 4320, hi: 8760 },
] as const;

export default function DataPage() {
  const publicClient = usePublicClient();
  const [mints, setMints] = useState<MintRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    (async () => {
      try {
        let fromBlock = 0n;
        if (!isDev) {
          try {
            const currentBlock = await publicClient.getBlockNumber();
            fromBlock = currentBlock > 20000n ? currentBlock - 20000n : 0n;
          } catch {
            fromBlock = 0n;
          }
        }

        const logs = await publicClient.getContractEvents({
          address: addresses.positionManager,
          abi: PositionManagerAbi,
          eventName: "PositionMinted",
          fromBlock,
          toBlock: "latest",
        });
        const parsed = parseEventLogs({ abi: PositionManagerAbi, eventName: "PositionMinted", logs });
        const records: MintRecord[] = parsed.map((e) => ({
          positionId: e.args.positionId,
          lp: e.args.economics.lp,
          collateralAsset: e.args.economics.collateralAsset,
          optionType: e.args.economics.optionType,
          units: e.args.economics.units,
          unitScalarNum: e.args.economics.unitScalarNum,
          unitScalarDen: e.args.economics.unitScalarDen,
          feeBps: e.args.economics.feeBps,
          expiry: e.args.economics.expiry,
          blockNumber: e.blockNumber ?? 0n,
        }));
        if (!cancelled) setMints(records);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, retryTick]);

  // Profiles and quotes loaded from the SQLite-backed API.
  const [allProfiles, setAllProfiles] = useState<SignedLiquidityProfile[]>([]);
  const [allQuotes, setAllQuotes] = useState<SignedBackerQuote[]>([]);
  useEffect(() => {
    listProfiles().then(setAllProfiles);
    listQuotes().then(setAllQuotes);
  }, []);

  // Protocol-wide liquidity view: unlike the Market hub (which is scoped to one asset at a
  // time because a taker mints against exactly one), this dashboard combines every asset's
  // entries into one picture of aggregate depth.
  const entries = useMemo(
    () => ASSETS.flatMap((asset) => buildMarketEntries(allProfiles, allQuotes, asset)),
    [allProfiles, allQuotes],
  );

  const consumedReads = useReadContracts({
    contracts: entries.map((e) => ({
      address: e.kind === "profile" ? addresses.positionManager : addresses.lpRouter,
      abi: e.kind === "profile" ? PositionManagerAbi : LPRouterAbi,
      functionName: e.kind === "profile" ? "consumedUnits" : "consumedUnitsForQuote",
      args: [e.hash],
    })),
    query: { enabled: entries.length > 0, retry: false, staleTime: 30_000 },
  });

  const consumedByHash = useMemo(() => {
    const map: Record<Hex, bigint> = {};
    entries.forEach((e, i) => {
      const v = consumedReads.data?.[i]?.result as bigint | undefined;
      map[e.hash] = v ?? 0n;
    });
    return map;
  }, [entries, consumedReads.data]);

  const stats = useMemo(() => computeProtocolStats(mints ?? []), [mints]);

  const durationDepth = useMemo(
    () =>
      DURATION_BUCKETS.map((b) => {
        const mid = (b.lo + b.hi) / 2;
        const total = entries
          .filter((e) => e.data.minHours <= mid && e.data.maxHours >= mid)
          .reduce((sum, e) => sum + Number(remainingUnits(e, consumedByHash)), 0);
        return { ...b, total };
      }),
    [entries, consumedByHash],
  );

  const priceBuckets = useMemo(
    () =>
      histogram(
        entries,
        (e) => entryHumanRate(e),
        (e) => Number(remainingUnits(e, consumedByHash)),
        PRICE_DOMAIN,
        10,
      ),
    [entries, consumedByHash],
  );

  const topByCapacity = useMemo(
    () =>
      [...entries]
        .sort((a, b) => Number(remainingUnits(b, consumedByHash)) - Number(remainingUnits(a, consumedByHash)))
        .slice(0, 8),
    [entries, consumedByHash],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Protocol Analytics"
        tooltip="Aggregated on-chain protocol metrics, liquidity order book depth, and historical execution stats."
      />

      {error && <ErrorBanner message={`Sync error: ${error}`} onRetry={() => setRetryTick((n) => n + 1)} />}
      {consumedReads.isError && <ErrorBanner message="Live capacity read failed." />}

      {mints === null && !error ? (
        <p className="text-xs text-[var(--text-muted)]">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            label="Positions"
            tooltip="Total options positions minted across all time on Base."
            value={stats.totalPositions.toLocaleString()}
          />
          <StatTile
            label="Units"
            tooltip="Cumulative notional volume in units minted across all options contracts."
            value={stats.totalUnits.toLocaleString()}
          />
          <StatTile
            label="Solo Mints"
            tooltip="Positions minted directly against single EIP-712 liquidity profiles."
            value={stats.soloCount.toLocaleString()}
            accent="cyan"
          />
          <StatTile
            label="Router Mints"
            tooltip="Positions matched and aggregated across multiple backer quotes via LPRouter."
            value={stats.routerBackedCount.toLocaleString()}
            accent="amber"
          />
          <StatTile
            label="Solo LPs"
            tooltip="Distinct liquidity provider wallet addresses providing liquidity profiles."
            value={stats.distinctLps.toLocaleString()}
          />
          <StatTile
            label="CALL / PUT"
            tooltip="Ratio of bullish call contracts to bearish put contracts minted."
            value={`${stats.callCount} / ${stats.putCount}`}
            accent="emerald"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-bold text-[var(--foreground)]">Cumulative Mints</h2>
          <CumulativeChart points={stats.cumulative} />
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-bold text-[var(--foreground)]">Option Split</h2>
          <SplitBar
            a={{ label: "CALL", value: stats.callCount, className: "bg-[var(--emerald-text)]" }}
            b={{ label: "PUT", value: stats.putCount, className: "bg-[var(--amber-text)]" }}
          />
          <h2 className="mt-5 text-sm font-bold text-[var(--foreground)]">Route Split</h2>
          <SplitBar
            a={{ label: "Solo", value: stats.soloCount, className: "bg-[var(--base-blue)]" }}
            b={{ label: "Router", value: stats.routerBackedCount, className: "bg-[var(--base-blue-light)]" }}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-bold text-[var(--foreground)]">Depth by Duration</h2>
          <BarChart buckets={durationDepth.map((b) => ({ label: b.label, value: b.total }))} color="var(--base-blue-light)" />
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-bold text-[var(--foreground)]">Rate Distribution</h2>
          <BarChart
            buckets={priceBuckets.map((b) => ({ label: `$${b.x0 < 0.01 ? b.x0.toFixed(4) : b.x0.toFixed(3)}`, value: b.total }))}
            colorFor={(_, i) => marketPriceColor(priceBuckets[i].x0)}
          />
        </Card>
      </div>

      {/* ds-allow-hardcode:start */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2.5 text-sm font-bold text-[var(--foreground)]">Asset Breakdown</h2>
          <div role="region" aria-label="Per-asset breakdown table" tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] rounded-lg">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="text-[var(--text-muted)]">
                <tr>
                  <th className="pb-2 font-medium">Asset</th>
                  <th className="pb-2 font-medium">Positions</th>
                  <th className="pb-2 font-medium">Units</th>
                  <th className="pb-2 font-medium">Notional</th>
                </tr>
              </thead>
              <tbody className="text-[var(--foreground)]">
                {stats.byAsset.map((a) => (
                  <tr key={a.asset} className="border-t border-[var(--border)]">
                    <td className="py-2">
                      <Badge>{assetSymbol(a.asset)}</Badge>
                    </td>
                    <td className="py-2 font-mono tabular-nums">{a.count}</td>
                    <td className="py-2 font-mono tabular-nums">{a.units.toString()}</td>
                    <td className="py-2 font-mono tabular-nums">
                      {a.notional.toLocaleString(undefined, { maximumFractionDigits: 2 })} {assetSymbol(a.asset)}
                    </td>
                  </tr>
                ))}
                {stats.byAsset.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-[var(--text-muted)]">
                      No mints yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2.5 text-sm font-bold text-[var(--foreground)]">Top Solo LPs</h2>
          <div role="region" aria-label="Top solo LPs table" tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] rounded-lg">
            <table className="w-full min-w-[360px] text-left text-xs">
              <thead className="text-[var(--text-muted)]">
                <tr>
                  <th className="pb-2 font-medium">LP</th>
                  <th className="pb-2 font-medium">Positions</th>
                  <th className="pb-2 font-medium">Units</th>
                </tr>
              </thead>
              <tbody className="text-[var(--foreground)]">
                {stats.topLps.map((l) => (
                  <tr key={l.lp} className="border-t border-[var(--border)]">
                    <td className="py-2 font-mono">{l.lp.slice(0, 10)}...</td>
                    <td className="py-2 font-mono tabular-nums">{l.count}</td>
                    <td className="py-2 font-mono tabular-nums">{l.units.toString()}</td>
                  </tr>
                ))}
                {stats.topLps.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-[var(--text-muted)]">
                      No solo mints yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Deepest live offers right now</h2>
        <div role="region" aria-label="Deepest live offers table" tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] rounded-lg">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[var(--text-muted)]">
              <tr>
                <th className="pb-2 font-medium">Kind</th>
                <th className="pb-2 font-medium">Provider</th>
                <th className="pb-2 font-medium">Asset</th>
                <th className="pb-2 font-medium">Duration</th>
                <th className="pb-2 font-medium">Rate</th>
                <th className="pb-2 font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody className="text-[var(--foreground)]">
              {topByCapacity.map((e) => (
                <tr key={e.hash} className="border-t border-[var(--border)]">
                  <td className="py-2">
                    <Badge tone={e.kind === "profile" ? "blue" : "amber"}>{e.kind === "profile" ? "solo" : "router"}</Badge>
                  </td>
                  <td className="py-2 font-mono">{entryProvider(e).slice(0, 10)}...</td>
                  <td className="py-2">{assetSymbol(e.data.collateralAsset)}</td>
                  <td className="py-2 font-mono tabular-nums">
                    {formatDuration(e.data.minHours)}–{formatDuration(e.data.maxHours)}
                  </td>
                  <td className="py-2 font-mono tabular-nums">
                    ${entryHumanRate(e).toLocaleString(undefined, { maximumFractionDigits: 4 })}/hr
                  </td>
                  <td className="py-2 font-mono tabular-nums">{remainingUnits(e, consumedByHash).toString()}</td>
                </tr>
              ))}
              {topByCapacity.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-[var(--text-muted)]">
                    No live offers found for either asset.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Recent mints</h2>
        <div role="region" aria-label="Recent mints table" tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] rounded-lg">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-[var(--text-muted)]">
              <tr>
                <th className="pb-2 font-medium">Position</th>
                <th className="pb-2 font-medium">Asset</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Units</th>
                <th className="pb-2 font-medium">LP</th>
                <th className="pb-2 font-medium">Block</th>
              </tr>
            </thead>
            <tbody className="text-[var(--foreground)]">
              {stats.recent.map((m) => (
                <tr key={m.positionId.toString()} className="border-t border-[var(--border)]">
                  <td className="py-2 font-mono tabular-nums">#{m.positionId.toString()}</td>
                  <td className="py-2">{assetSymbol(m.collateralAsset)}</td>
                  <td className="py-2">
                    <Badge tone={m.optionType === 0 ? "emerald" : "amber"}>{m.optionType === 0 ? "CALL" : "PUT"}</Badge>
                  </td>
                  <td className="py-2 font-mono tabular-nums">{m.units.toString()}</td>
                  <td className="py-2 font-mono">{isRouterBacked(m) ? "LPRouter" : `${m.lp.slice(0, 10)}...`}</td>
                  <td className="py-2 font-mono tabular-nums">{m.blockNumber.toString()}</td>
                </tr>
              ))}
              {stats.recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-[var(--text-muted)]">
                    No mints yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {/* ds-allow-hardcode:end */}
    </div>
  );
}

function SplitBar({
  a,
  b,
}: {
  a: { label: string; value: number; className: string };
  b: { label: string; value: number; className: string };
}) {
  const total = a.value + b.value;
  const aPct = total > 0 ? (a.value / total) * 100 : 50;
  return (
    <div className="mt-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--surface-raised)] border border-[var(--border)]">
        <div className={a.className} style={{ width: `${aPct}%` }} />
        <div className={b.className} style={{ width: `${100 - aPct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-[var(--text-muted)]">
        <span>
          {a.label} <span className="font-mono tabular-nums font-semibold text-[var(--foreground)]">{a.value}</span>
        </span>
        <span>
          {b.label} <span className="font-mono tabular-nums font-semibold text-[var(--foreground)]">{b.value}</span>
        </span>
      </div>
    </div>
  );
}

const BAR_WIDTH = 560;
const BAR_HEIGHT = 160;
const BAR_MARGIN = { top: 8, bottom: 20, left: 4, right: 4 };

function BarChart({
  buckets,
  color,
  colorFor,
}: {
  buckets: { label: string; value: number }[];
  color?: string;
  colorFor?: (value: number, i: number) => string;
}) {
  const plotWidth = BAR_WIDTH - BAR_MARGIN.left - BAR_MARGIN.right;
  const plotHeight = BAR_HEIGHT - BAR_MARGIN.top - BAR_MARGIN.bottom;
  const maxVal = Math.max(...buckets.map((b) => b.value), 1);
  const slot = plotWidth / buckets.length;
  const barWidth = slot * 0.7;

  return (
    <svg viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`} className="mt-3 w-full" aria-hidden="true">
      {buckets.map((b, i) => {
        const h = (b.value / maxVal) * plotHeight;
        const x = BAR_MARGIN.left + i * slot + (slot - barWidth) / 2;
        const y = BAR_MARGIN.top + (plotHeight - h);
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={barWidth} height={Math.max(h, 1)} fill={colorFor ? colorFor(b.value, i) : color} rx={2} />
            <text x={x + barWidth / 2} y={BAR_HEIGHT - 6} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CumulativeChart({ points }: { points: { blockNumber: number; count: number }[] }) {
  if (points.length === 0) {
    return <p className="mt-6 text-sm text-[var(--text-muted)]">No mints yet.</p>;
  }
  const width = BAR_WIDTH;
  const height = BAR_HEIGHT;
  const margin = { top: 10, bottom: 20, left: 32, right: 10 };
  const blocks = points.map((p) => p.blockNumber);
  const minBlock = Math.min(...blocks);
  const maxBlock = Math.max(...blocks, minBlock + 1);
  const maxCount = points[points.length - 1].count;

  const xScale: Scale = makeLinearScale([minBlock, maxBlock], margin.left, width - margin.right);
  const yScale: Scale = makeLinearScale([0, maxCount], height - margin.bottom, margin.top);

  const path =
    `M ${xScale.scale(minBlock)},${yScale.scale(0)} L ` +
    points.map((p) => `${xScale.scale(p.blockNumber)},${yScale.scale(p.count)}`).join(" L ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" aria-hidden="true">
      <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="var(--border)" />
      <text x={margin.left} y={height - 4} fontSize={9} fill="var(--text-muted)">
        block {minBlock}
      </text>
      <text x={width - margin.right} y={height - 4} fontSize={9} fill="var(--text-muted)" textAnchor="end">
        block {maxBlock}
      </text>
      <text x={4} y={margin.top + 4} fontSize={9} fill="var(--text-muted)">
        {maxCount}
      </text>
      <path d={path} fill="none" stroke="var(--base-blue-light)" strokeWidth={1.5} />
    </svg>
  );
}
