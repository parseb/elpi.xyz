// Shared, dependency-free SVG-chart primitives — scales, ticks, color and bucketing helpers.
// Used by MarketChart (the market hub) and the /data analytics dashboard, which is the only
// reason this lives outside either component: two independent hand-rolled charts drifting
// into two slightly different log-scale implementations is exactly the kind of thing that
// causes subtle "why do these numbers look different" bugs later.

export interface Scale {
  scale: (v: number) => number;
  invert: (px: number) => number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function makeLogScale([lo, hi]: [number, number], pxLo: number, pxHi: number): Scale {
  const logLo = Math.log10(Math.max(lo, 1));
  const logHi = Math.log10(Math.max(hi, lo + 1));
  const span = logHi - logLo || 1;
  return {
    scale: (v: number) => pxLo + ((Math.log10(Math.max(v, 1)) - logLo) / span) * (pxHi - pxLo),
    invert: (px: number) => 10 ** (logLo + ((px - pxLo) / (pxHi - pxLo)) * span),
  };
}

export function makeLinearScale([lo, hi]: [number, number], pxLo: number, pxHi: number): Scale {
  const span = hi - lo || 1;
  return {
    scale: (v: number) => pxLo + ((v - lo) / span) * (pxHi - pxLo),
    invert: (px: number) => lo + ((px - pxLo) / (pxHi - pxLo)) * span,
  };
}

export function logTicks([lo, hi]: [number, number]): number[] {
  const ticks = [1, 6, 24, 168, 720, 2160, 4320, 8760].filter((t) => t >= lo * 0.9 && t <= hi * 1.1);
  return ticks.length > 0 ? ticks : [Math.round(lo), Math.round(hi)];
}

export function linearTicks([lo, hi]: [number, number], count = 5): number[] {
  const step = (hi - lo) / count;
  if (step <= 0) return [lo];
  return Array.from({ length: count + 1 }, (_, i) => Math.round(lo + step * i));
}

/// Electric cyan (cheap) -> red (expensive) — the price-rate gradient used across the market
/// chart and the analytics dashboard's price histogram, so "warm = expensive" reads the
/// same way in both places. Keyed to the luminous cyan primary.
const PRICE_COLOR_FROM = [0, 240, 255]; // Electric cyan rgb(0, 240, 255)
const PRICE_COLOR_TO = [239, 68, 68]; // red rgb(239, 68, 68)

export function priceColor(price: number, minPrice: number, maxPrice: number): string {
  const t = clamp((price - minPrice) / (maxPrice - minPrice || 1), 0, 1);
  const c = PRICE_COLOR_FROM.map((f, i) => Math.round(f + (PRICE_COLOR_TO[i] - f) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/// The seed data's fixed $1-100/unit/hr rate range (script/SeedLiquidity.s.sol's MIN_PRICE/
/// MAX_PRICE) — shared so the market chart's bars and the analytics dashboard's price
/// histogram color the same rate the same way.
export const PRICE_DOMAIN: [number, number] = [0.00006, 0.028];

export function marketPriceColor(price: number): string {
  return priceColor(price, PRICE_DOMAIN[0], PRICE_DOMAIN[1]);
}

/// Buckets values into `count` equal-width bins over [lo, hi] and returns per-bucket sums of
/// `weight(item)` — the shared histogram primitive behind the chart's depth overlay and the
/// dashboard's duration/price histograms.
export function histogram<T>(
  items: T[],
  value: (item: T) => number,
  weight: (item: T) => number,
  [lo, hi]: [number, number],
  count: number,
): { x0: number; x1: number; total: number }[] {
  const span = hi - lo || 1;
  const buckets = Array.from({ length: count }, (_, i) => ({
    x0: lo + (i / count) * span,
    x1: lo + ((i + 1) / count) * span,
    total: 0,
  }));
  for (const item of items) {
    const v = value(item);
    let idx = Math.floor(((v - lo) / span) * count);
    idx = clamp(idx, 0, count - 1);
    buckets[idx].total += weight(item);
  }
  return buckets;
}

export function logSamplePoints([lo, hi]: [number, number], count: number): number[] {
  const logLo = Math.log10(Math.max(lo, 1));
  const logHi = Math.log10(Math.max(hi, lo + 1));
  return Array.from({ length: count }, (_, i) => 10 ** (logLo + ((logHi - logLo) * i) / (count - 1)));
}

/// For each sample point, sums the weight of every [lo, hi] range that contains it — the
/// "how much total liquidity is available at this duration" curve overlaid on the market
/// chart's individual bars. O(samples * ranges), trivial at this app's data sizes.
export function rangeDepthCurve(ranges: { lo: number; hi: number; weight: number }[], samplePoints: number[]): number[] {
  return samplePoints.map((x) => {
    let total = 0;
    for (const r of ranges) {
      if (x >= r.lo && x <= r.hi) total += r.weight;
    }
    return total;
  });
}

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/**
 * Formats duration in hours smoothly transitioning to days when duration >= 24h.
 * - < 24h: "1h", "6h", "23h"
 * - >= 24h: "1d", "1.5d", "7d", "30d", "90d", "365d"
 */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (hours % 24 === 0) return `${Math.round(days)}d`;
  return `${Number(days.toFixed(1))}d`;
}

/**
 * Detailed duration formatting with both days and hours when >= 24h.
 * e.g. "1.5d (36h)" or "7d (168h)"
 */
export function formatDurationFull(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (hours % 24 === 0) return `${Math.round(days)}d (${hours}h)`;
  return `${Number(days.toFixed(1))}d (${hours}h)`;
}

/**
 * Parses user duration input string supporting hours and days.
 * Examples: "36" -> 36, "36h" -> 36, "7d" -> 168, "1.5d" -> 36, "1y" -> 8760, "1w" -> 168.
 */
export function parseDuration(input: string, fallbackHours = 24): number {
  if (!input || typeof input !== "string") return fallbackHours;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.endsWith("d")) {
    const num = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(num) && num > 0 ? Math.round(num * 24) : fallbackHours;
  }
  if (trimmed.endsWith("w")) {
    const num = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(num) && num > 0 ? Math.round(num * 168) : fallbackHours;
  }
  if (trimmed.endsWith("y")) {
    const num = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(num) && num > 0 ? Math.round(num * 8760) : fallbackHours;
  }
  if (trimmed.endsWith("h")) {
    const num = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(num) && num > 0 ? Math.round(num) : fallbackHours;
  }
  const num = parseFloat(trimmed);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : fallbackHours;
}
