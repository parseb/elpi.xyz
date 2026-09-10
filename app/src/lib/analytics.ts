import type { Address } from "viem";
import { addresses } from "@/config/addresses";

export interface MintRecord {
  positionId: bigint;
  lp: Address;
  collateralAsset: Address;
  optionType: number;
  units: bigint;
  unitScalarNum: bigint;
  unitScalarDen: bigint;
  feeBps: number;
  expiry: bigint;
  blockNumber: bigint;
}

export function isRouterBacked(m: Pick<MintRecord, "lp">): boolean {
  return m.lp.toLowerCase() === addresses.lpRouter.toLowerCase();
}

/// PositionManager.sol:293 computes the actual on-chain (decimals-scaled) transfer amount as
/// `units * unitScalarNum * 10**collateralDecimals / unitScalarDen`. The `10**collateralDecimals`
/// term cancels exactly when converting that raw amount back to whole-token terms, so the
/// human-readable notional is just `units * num / den` — plain JS numbers are safe here (units
/// and scalars are always small at this app's scale) without ever touching the 1e18-range raw
/// amount or needing to know `collateralDecimals` at all. See decimal-awareness: this
/// deliberately avoids hardcoding or guessing a decimals figure rather than risking one.
export function collateralNotional(m: Pick<MintRecord, "units" | "unitScalarNum" | "unitScalarDen">): number {
  return (Number(m.units) * Number(m.unitScalarNum)) / Number(m.unitScalarDen);
}

export interface AssetBreakdown {
  asset: Address;
  count: number;
  units: bigint;
  notional: number;
}

export interface LpBreakdown {
  lp: Address;
  count: number;
  units: bigint;
}

export interface ProtocolStats {
  totalPositions: number;
  totalUnits: bigint;
  callCount: number;
  putCount: number;
  routerBackedCount: number;
  soloCount: number;
  distinctLps: number;
  byAsset: AssetBreakdown[];
  topLps: LpBreakdown[];
  cumulative: { blockNumber: number; count: number }[];
  recent: MintRecord[];
}

export function computeProtocolStats(mints: MintRecord[]): ProtocolStats {
  const sorted = [...mints].sort((a, b) => Number(a.positionId - b.positionId));

  let totalUnits = 0n;
  let callCount = 0;
  let putCount = 0;
  let routerBackedCount = 0;
  const byAsset = new Map<string, AssetBreakdown>();
  const byLp = new Map<string, LpBreakdown>();
  const cumulative: { blockNumber: number; count: number }[] = [];

  sorted.forEach((m, i) => {
    totalUnits += m.units;
    if (m.optionType === 0) callCount++;
    else putCount++;
    if (isRouterBacked(m)) routerBackedCount++;

    const assetKey = m.collateralAsset.toLowerCase();
    const a = byAsset.get(assetKey) ?? { asset: m.collateralAsset, count: 0, units: 0n, notional: 0 };
    a.count++;
    a.units += m.units;
    a.notional += collateralNotional(m);
    byAsset.set(assetKey, a);

    if (!isRouterBacked(m)) {
      const lpKey = m.lp.toLowerCase();
      const l = byLp.get(lpKey) ?? { lp: m.lp, count: 0, units: 0n };
      l.count++;
      l.units += m.units;
      byLp.set(lpKey, l);
    }

    cumulative.push({ blockNumber: Number(m.blockNumber), count: i + 1 });
  });

  return {
    totalPositions: sorted.length,
    totalUnits,
    callCount,
    putCount,
    routerBackedCount,
    soloCount: sorted.length - routerBackedCount,
    distinctLps: byLp.size,
    byAsset: [...byAsset.values()].sort((a, b) => b.count - a.count),
    topLps: [...byLp.values()].sort((a, b) => Number(b.units - a.units)).slice(0, 8),
    cumulative,
    recent: [...sorted].reverse().slice(0, 15),
  };
}
