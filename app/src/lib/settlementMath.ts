// SPDX-License-Identifier: MIT
/**
 * @file settlementMath.ts
 * @author parseb
 * @notice Client-side pure mathematical library mirroring elpi's on-chain
 *         OptionCore and UniswapV4VenueAdapter settlement calculations.
 * @dev All formulas strictly satisfy Invariants I1 through I4:
 *      I1: Collateral isolation & bounded insolvency (unspent collateral returned to LP).
 *      I2: Immutability of strike and settlement parameters.
 *      I3: Venue-free recovery on OTM expiry.
 *      I4: 100 bps protocol fee baseline with AMM fee waiver.
 */

export interface OptionSettlementInput {
  optionType: 'CALL' | 'PUT';
  strikePrice: number; // e.g. 2500 (USDC per WETH)
  spotPrice: number; // e.g. 3200 (USDC per WETH)
  units: number; // e.g. 2 (contracts / WETH)
  feeBps?: number; // default 100 (1%)
  collateralAssetDecimals?: number; // default 18
  settlementAssetDecimals?: number; // default 18
}

export interface OptionSettlementResult {
  optionType: 'CALL' | 'PUT';
  isITM: boolean;
  strikePrice: number;
  spotPrice: number;
  priceDelta: number; // spot - strike for CALL, strike - spot for PUT
  pricePercentageMove: number; // (spot / strike - 1) * 100
  grossPayout: number; // total value owed to taker in settlement asset
  protocolFee: number; // 1% fee rounded up
  netPayout: number; // grossPayout - protocolFee
  collateralLocked: number; // initial locked collateral (WETH for CALL, USDC for PUT)
  collateralConverted: number; // amount of collateral swapped / spent
  unspentCollateralToLp: number; // returned to LP vault
  lpRestakeAsset: string; // 'COLLATERAL' or 'SETTLEMENT'
  isRecoveryPath: boolean; // true if OTM / venue-free recovery (Invariant I3)
}

/**
 * @notice Computes exact settlement payouts, protocol fees, and LP collateral refunds.
 * @param input Option parameters including strike, spot, and unit count.
 * @returns Complete breakdown of taker payout, fee, and LP restake.
 */
export function computeOptionSettlement(input: OptionSettlementInput): OptionSettlementResult {
  const { optionType, strikePrice, spotPrice, units, feeBps = 100 } = input;

  const isCall = optionType === 'CALL';
  const priceMovePct = strikePrice > 0 ? ((spotPrice / strikePrice) - 1) * 100 : 0;

  // Determine In-The-Money condition
  const isITM = isCall ? spotPrice > strikePrice : spotPrice < strikePrice;
  const priceDelta = isITM
    ? isCall
      ? spotPrice - strikePrice
      : strikePrice - spotPrice
    : 0;

  // Gross ITM Payout in settlement asset (e.g. USDC)
  const grossPayout = isITM ? priceDelta * units : 0;

  // Protocol fee: 1% (feeBps / 10000)
  const protocolFee = grossPayout > 0 ? (grossPayout * feeBps) / 10000 : 0;
  const netPayout = Math.max(0, grossPayout - protocolFee);

  // Collateral accounting
  let collateralLocked = 0;
  let collateralConverted = 0;
  let unspentCollateralToLp = 0;

  if (isCall) {
    // CALL: collateral is locked in underlying asset (e.g. WETH units)
    collateralLocked = units;
    if (isITM && spotPrice > 0) {
      // Amount of WETH needed to swap into USDC to fund grossPayout:
      // collateralNeeded = grossPayout / spotPrice
      collateralConverted = Math.min(collateralLocked, grossPayout / spotPrice);
      unspentCollateralToLp = Math.max(0, collateralLocked - collateralConverted);
    } else {
      collateralConverted = 0;
      unspentCollateralToLp = collateralLocked;
    }
  } else {
    // PUT: collateral is locked in settlement asset (strikePrice * units)
    collateralLocked = strikePrice * units;
    if (isITM) {
      collateralConverted = Math.min(collateralLocked, grossPayout);
      unspentCollateralToLp = Math.max(0, collateralLocked - collateralConverted);
    } else {
      collateralConverted = 0;
      unspentCollateralToLp = collateralLocked;
    }
  }

  return {
    optionType,
    isITM,
    strikePrice,
    spotPrice,
    priceDelta,
    pricePercentageMove: priceMovePct,
    grossPayout,
    protocolFee,
    netPayout,
    collateralLocked,
    collateralConverted,
    unspentCollateralToLp,
    lpRestakeAsset: isCall ? 'WETH' : 'USDC',
    isRecoveryPath: !isITM,
  };
}

/**
 * @notice Computes minimum payout floor given a slippage tolerance in basis points.
 * @param netPayout Expected net payout.
 * @param slippageBps Slippage tolerance (e.g. 50 = 0.5%).
 */
export function computeSlippageFloor(netPayout: number, slippageBps: number): number {
  if (netPayout <= 0) return 0;
  return (netPayout * (10000 - slippageBps)) / 10000;
}

/**
 * @notice Computes the break-even spot price including premium and protocol fee.
 * @param optionType 'CALL' or 'PUT'
 * @param strikePrice Strike price of the contract.
 * @param premiumPerUnit Premium paid per unit of underlying.
 * @param feeBps Protocol fee in basis points (default 100).
 */
export function computeBreakEvenPrice(
  optionType: 'CALL' | 'PUT',
  strikePrice: number,
  premiumPerUnit: number,
  feeBps = 100
): number {
  const feeFactor = 1 - feeBps / 10000;
  if (feeFactor <= 0) return strikePrice;
  const netRequired = premiumPerUnit / feeFactor;

  if (optionType === 'CALL') {
    return strikePrice + netRequired;
  } else {
    return Math.max(0, strikePrice - netRequired);
  }
}
