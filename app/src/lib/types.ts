// SPDX-License-Identifier: MIT
import type { Address, Hex } from 'viem';

/**
 * Uniswap v4 PoolKey structure matching PoolKey.sol in @uniswap/v4-core
 */
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number; // uint24 (e.g. 0x800000 for DYNAMIC_FEE_FLAG)
  tickSpacing: number; // int24
  hooks: Address;
}

/**
 * Result of the pre-trade settlement liquidity verification (§6.1)
 */
export interface LiquidityCheckResult {
  executable: boolean; // Can settle at oracle floor?
  expectedOutput: bigint; // Quoter simulated amountOut
  priceImpactBps: number; // Estimated price impact in basis points
  warning: string | null;
}

/**
 * Result of the dynamic routeId selection (§6.2)
 */
export interface RouteSelectionResult {
  routeId: Hex;
  poolKey: PoolKey;
  rationale: string;
}

/**
 * Continuous Clearing Auction (CCA) status for asset onboarding (§5.2)
 */
export interface CcaAuctionStatus {
  auctionId: string;
  tokenPair: [Address, Address];
  status: 'PENDING' | 'ACTIVE' | 'CLOSED' | 'SEEDED';
  clearingPrice?: bigint;
  seededPool?: PoolKey;
  totalOrders: number;
}
