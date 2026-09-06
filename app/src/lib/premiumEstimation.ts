// SPDX-License-Identifier: MIT

export interface OptionGreeks {
  delta: number;
  gamma: number;
  thetaPerDay: number;
  vega: number;
}

export interface PremiumAnalysis {
  flatRatePremium: number;
  benchmarkPremium: number;
  impliedVolAnnual: number;
  greeks: OptionGreeks;
  efficiency: 'DISCOUNT' | 'FAIR' | 'PREMIUM';
  differencePercent: number;
}

/**
 * Standard cumulative normal distribution function N(x)
 */
function cumulativeNormal(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Normal probability density function n(x)
 */
function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Implements Section 6.3 Premium Estimation Improvement
 * Compares LP flat rate (units * hours * rate) against Black-Scholes benchmark using Uniswap v4 pool IV.
 */
export function estimateOptionPremiumAndGreeks(params: {
  spotPrice: number;
  strikePrice: number;
  durationHours: number;
  units: number;
  ratePerHour: number;
  optionType: 'CALL' | 'PUT';
  riskFreeRate?: number;
  impliedVol?: number;
}): PremiumAnalysis {
  const {
    spotPrice,
    strikePrice,
    durationHours,
    units,
    ratePerHour,
    optionType,
    riskFreeRate = 0.04, // 4% Base risk-free rate default
    impliedVol = 0.62, // 62% typical ETH-USDC 30d annualized IV
  } = params;

  // 1. Flat rate premium
  const flatRatePremium = units * durationHours * ratePerHour;

  // 2. Black-Scholes calculation
  const T = Math.max(durationHours / 8760, 0.0001); // Time in years
  const sigma = impliedVol;
  const r = riskFreeRate;
  const S = spotPrice;
  const K = strikePrice;

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  let bsPricePerUnit = 0;
  let delta = 0;

  if (optionType === 'CALL') {
    bsPricePerUnit = S * cumulativeNormal(d1) - K * Math.exp(-r * T) * cumulativeNormal(d2);
    delta = cumulativeNormal(d1);
  } else {
    bsPricePerUnit = K * Math.exp(-r * T) * cumulativeNormal(-d2) - S * cumulativeNormal(-d1);
    delta = cumulativeNormal(d1) - 1;
  }

  // Ensure non-negative intrinsic minimum
  const intrinsic = optionType === 'CALL' ? Math.max(0, S - K) : Math.max(0, K - S);
  const benchmarkTotal = Math.max(intrinsic, bsPricePerUnit) * units;

  // 3. Greeks
  const gamma = normalPdf(d1) / (S * sigma * Math.sqrt(T));
  const thetaYearly =
    optionType === 'CALL'
      ? -(S * normalPdf(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * cumulativeNormal(d2)
      : -(S * normalPdf(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * cumulativeNormal(-d2);
  const thetaPerDay = (thetaYearly / 365) * units;
  const vega = S * Math.sqrt(T) * normalPdf(d1) * 0.01 * units;

  // 4. Efficiency comparison
  const diff = benchmarkTotal > 0 ? ((flatRatePremium - benchmarkTotal) / benchmarkTotal) * 100 : 0;
  let efficiency: 'DISCOUNT' | 'FAIR' | 'PREMIUM' = 'FAIR';
  if (diff < -5) {
    efficiency = 'DISCOUNT';
  } else if (diff > 5) {
    efficiency = 'PREMIUM';
  }

  return {
    flatRatePremium,
    benchmarkPremium: benchmarkTotal,
    impliedVolAnnual: impliedVol * 100,
    greeks: {
      delta,
      gamma,
      thetaPerDay,
      vega,
    },
    efficiency,
    differencePercent: diff,
  };
}
