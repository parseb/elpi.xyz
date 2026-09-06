// SPDX-License-Identifier: MIT
import type { Address, PublicClient } from 'viem';
import type { PoolKey, LiquidityCheckResult } from './types';

export interface VerifyLiquidityParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  oracleFloor: bigint; // minAmountOut from IPriceOracle
  slippageBps: number;
  poolKey: PoolKey;
  quoterAddress?: Address;
  client?: PublicClient;
}

/**
 * Simulates a settlement swap before an elpi (elpi.xyz) option position is minted.
 * Uses Uniswap v4 Quoter / view call off-chain without gas cost (§6.1).
 *
 * If expectedOutput < oracleFloor, settlement will revert on-chain; this function
 * returns executable = false to block or warn users before committing capital.
 */
export async function verifySettlementLiquidity(
  params: VerifyLiquidityParams
): Promise<LiquidityCheckResult> {
  const {
    amountIn,
    oracleFloor,
    slippageBps,
    poolKey,
    quoterAddress,
    client,
  } = params;

  if (amountIn === 0n) {
    return {
      executable: false,
      expectedOutput: 0n,
      priceImpactBps: 0,
      warning: 'Zero amountIn specified',
    };
  }

  try {
    let expectedOutput = 0n;

    // If a live viem client and quoter address are provided, simulate via quoteExactInputSingle
    if (client && quoterAddress) {
      const zeroForOne =
        params.tokenIn.toLowerCase() === poolKey.currency0.toLowerCase();

      // Minimal Uniswap v4 Quoter ABI
      const quoterAbi = [
        {
          name: 'quoteExactInputSingle',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              name: 'params',
              type: 'tuple',
              components: [
                {
                  name: 'poolKey',
                  type: 'tuple',
                  components: [
                    { name: 'currency0', type: 'address' },
                    { name: 'currency1', type: 'address' },
                    { name: 'fee', type: 'uint24' },
                    { name: 'tickSpacing', type: 'int24' },
                    { name: 'hooks', type: 'address' },
                  ],
                },
                { name: 'zeroForOne', type: 'bool' },
                { name: 'exactAmount', type: 'uint128' },
                { name: 'hookData', type: 'bytes' },
              ],
            },
          ],
          outputs: [
            { name: 'amountOut', type: 'uint256' },
            { name: 'gasEstimate', type: 'uint256' },
          ],
        },
      ] as const;

      const [amountOut] = (await (client as any).readContract({
        address: quoterAddress,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: {
              currency0: poolKey.currency0,
              currency1: poolKey.currency1,
              fee: poolKey.fee,
              tickSpacing: poolKey.tickSpacing,
              hooks: poolKey.hooks,
            },
            zeroForOne,
            exactAmount: BigInt(amountIn),
            hookData: '0x',
          },
        ],
      })) as [bigint, bigint];

      expectedOutput = amountOut;
    } else {
      // Fallback optimistic simulation: assumes 1:1 base price for offline calculations
      expectedOutput = amountIn;
    }

    // Check against oracle floor
    const executable = expectedOutput >= oracleFloor;

    // Calculate approximate price impact
    let priceImpactBps = 0;
    if (oracleFloor > 0n && expectedOutput < oracleFloor) {
      priceImpactBps = Number(((oracleFloor - expectedOutput) * 10000n) / oracleFloor);
    }

    let warning: string | null = null;
    if (!executable) {
      warning = `Insufficient liquidity: expected output (${expectedOutput.toString()}) is below oracle floor (${oracleFloor.toString()}). Settlement will revert.`;
    } else if (slippageBps > 0 && priceImpactBps > slippageBps) {
      warning = `High price impact: ${priceImpactBps / 100}% exceeds configured slippage tolerance ${slippageBps / 100}%.`;
    }

    return {
      executable,
      expectedOutput,
      priceImpactBps,
      warning,
    };
  } catch (error: any) {
    return {
      executable: false,
      expectedOutput: 0n,
      priceImpactBps: 10000,
      warning: `Liquidity simulation failed: ${error?.message || String(error)}`,
    };
  }
}
