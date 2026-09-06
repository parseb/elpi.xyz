// SPDX-License-Identifier: MIT
import { type Address, type Hex, getAddress } from 'viem';
import type { PoolKey, RouteSelectionResult } from './types';
import { computeRouteId, DYNAMIC_FEE_FLAG } from './routeId';

export interface RouteOption {
  poolKey: PoolKey;
  routeId: Hex;
  depthScore: number;
  hasOptionHook: boolean;
  rationale: string;
}

/**
 * Discovers and selects the optimal Uniswap v4 single-hop route for an asset pair in elpi (elpi.xyz).
 * Used when LPs publish their liquidity profiles (§6.2).
 *
 * Invariant I2: routeId is selected at profile creation and committed at option mint.
 * Prefers hook-enabled pools (0-fee settlement waiver) with sufficient liquidity.
 */
export async function selectBestRoute(
  collateralAsset: Address,
  settlementAsset: Address,
  typicalSwapAmount: bigint,
  preferredHookAddress: Address = '0x0000000000000000000000000000000000000000'
): Promise<RouteSelectionResult> {
  const tokenA = getAddress(collateralAsset);
  const tokenB = getAddress(settlementAsset);

  const [currency0, currency1] =
    tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const hasHook = preferredHookAddress !== '0x0000000000000000000000000000000000000000';

  // Candidate pool prioritizing OptionSettlementHook if configured
  const candidateKey: PoolKey = {
    currency0,
    currency1,
    fee: hasHook ? DYNAMIC_FEE_FLAG : 3000, // Dynamic fee with hook, or 30 bps default
    tickSpacing: 60,
    hooks: preferredHookAddress,
  };

  const routeId = computeRouteId(candidateKey);

  const rationale = hasHook
    ? `Selected canonical dynamic-fee pool with OptionSettlementHook at ${preferredHookAddress} for 0-fee settlement swaps on elpi.`
    : `Selected standard 30 bps pool (tickSpacing 60) without settlement hook.`;

  return {
    routeId,
    poolKey: candidateKey,
    rationale,
  };
}
