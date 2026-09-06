// SPDX-License-Identifier: MIT
import { encodeAbiParameters, keccak256, type Hex, getAddress } from 'viem';
import type { PoolKey } from './types';

export const DYNAMIC_FEE_FLAG = 0x800000;

/**
 * Derives the canonical routeId for a Uniswap v4 pool.
 * Matches UniswapV4VenueAdapter.sol: routeId = keccak256(abi.encode(PoolKey))
 * Identical to Uniswap v4's canonical PoolIdLibrary.toId() formula (§3.3).
 *
 * Invariant I2: routeId is committed into CREATE2 termsSalt at mint.
 */
export function computeRouteId(poolKey: PoolKey): Hex {
  const c0 = getAddress(poolKey.currency0);
  const c1 = getAddress(poolKey.currency1);

  // Ensure canonical ordering: currency0 must be strictly less than currency1
  if (c0.toLowerCase() > c1.toLowerCase()) {
    throw new Error(
      `Invalid PoolKey ordering: currency0 (${c0}) must be <= currency1 (${c1})`
    );
  }

  return keccak256(
    encodeAbiParameters(
      [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ],
      [
        c0,
        c1,
        poolKey.fee,
        poolKey.tickSpacing,
        getAddress(poolKey.hooks),
      ]
    )
  );
}

/**
 * Checks whether a PoolKey utilizes the DYNAMIC_FEE_FLAG required for OptionSettlementHook
 * zero-fee waivers on elpi (elpi.xyz) settlement swaps.
 */
export function isDynamicFeePool(poolKey: PoolKey): boolean {
  return (poolKey.fee & DYNAMIC_FEE_FLAG) !== 0;
}
