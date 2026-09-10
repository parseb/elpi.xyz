import type { Address } from "viem";
import { addresses } from "@/config/addresses";

// Symbol lookup for supported assets on Base / devnet (e.g. "WETH", "WBTC", "NVDA").
export function assetSymbol(addr: Address): string {
  const a = addr.toLowerCase();
  if (addresses.collateralAsset && a === addresses.collateralAsset.toLowerCase()) return "WETH";
  if (addresses.wbtcAsset && a === addresses.wbtcAsset.toLowerCase()) return "WBTC";
  if (addresses.nvdaAsset && a === addresses.nvdaAsset.toLowerCase() && addresses.nvdaAsset !== "0x0000000000000000000000000000000000000000") return "NVDA";
  if (addresses.wstethAsset && a === addresses.wstethAsset.toLowerCase()) return "wstETH";
  if (addresses.settlementAsset && a === addresses.settlementAsset.toLowerCase()) return "USDC";
  return `${addr.slice(0, 6)}...`;
}

// Display symbol for UI tabs & headers (displays unwrapped "ETH", "BTC" while underlying is wrapped token).
export function assetDisplaySymbol(addr: Address): string {
  const a = addr.toLowerCase();
  if (addresses.collateralAsset && a === addresses.collateralAsset.toLowerCase()) return "ETH";
  if (addresses.wbtcAsset && a === addresses.wbtcAsset.toLowerCase()) return "BTC";
  if (addresses.nvdaAsset && a === addresses.nvdaAsset.toLowerCase() && addresses.nvdaAsset !== "0x0000000000000000000000000000000000000000") return "NVDA";
  if (addresses.wstethAsset && a === addresses.wstethAsset.toLowerCase()) return "wstETH";
  if (addresses.settlementAsset && a === addresses.settlementAsset.toLowerCase()) return "USDC";
  return `${addr.slice(0, 6)}...`;
}

export function assetName(addr: Address): string {
  const a = addr.toLowerCase();
  if (addresses.collateralAsset && a === addresses.collateralAsset.toLowerCase()) return "Ethereum";
  if (addresses.wbtcAsset && a === addresses.wbtcAsset.toLowerCase()) return "Bitcoin";
  if (addresses.nvdaAsset && a === addresses.nvdaAsset.toLowerCase() && addresses.nvdaAsset !== "0x0000000000000000000000000000000000000000") return "Nvidia";
  if (addresses.wstethAsset && a === addresses.wstethAsset.toLowerCase()) return "Lido Staked ETH";
  if (addresses.settlementAsset && a === addresses.settlementAsset.toLowerCase()) return "USD Coin";
  return "Unknown Asset";
}

export interface AssetInfo {
  address: Address;
  symbol: string;
  displaySymbol: string;
  name: string;
  category: "Crypto" | "Equities" | "Commodities" | "LST";
  decimals: number;
}

export function getSupportedAssets(): AssetInfo[] {
  const list: AssetInfo[] = [];
  if (addresses.collateralAsset) {
    list.push({
      address: addresses.collateralAsset,
      symbol: "WETH",
      displaySymbol: "ETH",
      name: "Ethereum",
      category: "Crypto",
      decimals: 18,
    });
  }
  if (addresses.wbtcAsset) {
    list.push({
      address: addresses.wbtcAsset,
      symbol: "WBTC",
      displaySymbol: "BTC",
      name: "Bitcoin",
      category: "Crypto",
      decimals: 8,
    });
  }
  if (addresses.nvdaAsset && addresses.nvdaAsset !== "0x0000000000000000000000000000000000000000") {
    list.push({
      address: addresses.nvdaAsset,
      symbol: "NVDA",
      displaySymbol: "NVDA",
      name: "Nvidia",
      category: "Equities",
      decimals: 18,
    });
  }
  if (addresses.wstethAsset && addresses.wstethAsset !== "0x0000000000000000000000000000000000000000") {
    list.push({
      address: addresses.wstethAsset,
      symbol: "wstETH",
      displaySymbol: "wstETH",
      name: "Lido Staked ETH",
      category: "LST",
      decimals: 18,
    });
  }
  return list;
}

export function assetDecimals(addr: Address): number {
  const a = addr.toLowerCase();
  if (addresses.collateralAsset && a === addresses.collateralAsset.toLowerCase()) return 18; // WETH
  if (addresses.wbtcAsset && a === addresses.wbtcAsset.toLowerCase()) return 8; // WBTC
  if (addresses.nvdaAsset && a === addresses.nvdaAsset.toLowerCase()) return 18; // NVDA
  if (addresses.wstethAsset && a === addresses.wstethAsset.toLowerCase()) return 18; // wstETH
  if (addresses.settlementAsset && a === addresses.settlementAsset.toLowerCase()) return 6; // USDC
  return 18;
}

// Option Unit Scalar: 1 Unit = 0.01 Underlying Asset (unitScalarNum=1, unitScalarDen=100)
export const UNIT_SCALAR = 0.01;

export function unitsToAsset(units: number | bigint): number {
  return Number(units) * UNIT_SCALAR;
}

export function assetToUnits(assetQty: number): bigint {
  if (isNaN(assetQty) || assetQty <= 0) return 0n;
  return BigInt(Math.round(assetQty / UNIT_SCALAR));
}

export function formatAsset(units: number | bigint, symbol: string): string {
  const n = Number(units);
  const assetQty = unitsToAsset(n);
  const formattedAsset =
    assetQty >= 1000
      ? assetQty.toLocaleString("en-US", { maximumFractionDigits: 4 })
      : assetQty.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `${formattedAsset} ${symbol}`;
}

export function formatUnitWithAsset(units: number | bigint, symbol: string): string {
  return formatAsset(units, symbol);
}

/**
 * Formats seconds until expiry into a human-readable countdown string.
 * Examples:
 * - "Expires in 2d 5h 30m"
 * - "Expires in 5h 20m"
 * - "Expires in 45m"
 * - "Expires in <1m"
 * - "Expired 2h 15m ago"
 */
export function formatExpiryCountdown(
  expiryTimestampSec: number | bigint,
  nowSec: number = Math.floor(Date.now() / 1000)
): string {
  const expiry = Number(expiryTimestampSec);
  const diffSec = expiry - nowSec;

  if (diffSec > 0) {
    const days = Math.floor(diffSec / 86400);
    const hours = Math.floor((diffSec % 86400) / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);

    return `Expires in ${parts.join(" ")}`;
  } else {
    const elapsedSec = Math.abs(diffSec);
    const days = Math.floor(elapsedSec / 86400);
    const hours = Math.floor((elapsedSec % 86400) / 3600);
    const mins = Math.floor((elapsedSec % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);

    return `Expired ${parts.join(" ")} ago`;
  }
}

/**
 * Formats a Date/timestamp into "Expiry: M/D/YYYY H:MM AM/PM" format for tooltip hover.
 * Example: "Expiry: 9/1/2026 12:25 AM"
 */
export function formatExpiryDateHover(expiryTimestampSec: number | bigint): string {
  const d = new Date(Number(expiryTimestampSec) * 1000);
  const dateStr = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Expiry: ${dateStr} ${timeStr}`;
}

export function explorerAddressUrl(addr: Address | string): string {
  return `https://basescan.org/address/${addr}`;
}

export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}


