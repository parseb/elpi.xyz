// SPDX-License-Identifier: MIT
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';

// ─── Network & Canonical Addresses on Base ────────────────────────────────────

export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const CONTRACT_ADDRESSES = {
  // Base Mainnet / Anvil Devnet (8453)
  [BASE_CHAIN_ID]: {
    weth: (process.env.NEXT_PUBLIC_BASE_WETH ||
      '0x4200000000000000000000000000000000000006') as Address,
    wbtc: (process.env.NEXT_PUBLIC_BASE_WBTC ||
      '0x0000000000000000000000000000000000000000') as Address,
    usdc: (process.env.NEXT_PUBLIC_BASE_USDC ||
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') as Address,
    chainlinkEthUsd: (process.env.NEXT_PUBLIC_BASE_CHAINLINK_ETH_USD ||
      '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70') as Address,
    poolManager: (process.env.NEXT_PUBLIC_BASE_POOL_MANAGER ||
      '0x0000000000000000000000000000000000000000') as Address,
    venueAdapter: (process.env.NEXT_PUBLIC_BASE_VENUE_ADAPTER ||
      '0x0000000000000000000000000000000000000000') as Address,
    optionSettlementHook: (process.env.NEXT_PUBLIC_BASE_OPTION_HOOK ||
      '0xcb77AF9D41Df699ac24966B25bF1e504C66f00c8') as Address,
    vault: (process.env.NEXT_PUBLIC_BASE_VAULT ||
      '0x0000000000000000000000000000000000000000') as Address,
    mockVenue: (process.env.NEXT_PUBLIC_BASE_MOCK_VENUE ||
      '0x0000000000000000000000000000000000000000') as Address,
    routeId: (process.env.NEXT_PUBLIC_BASE_ROUTE_ID ||
      '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex,
    positionManager: (process.env.NEXT_PUBLIC_BASE_POSITION_MANAGER ||
      '0x0000000000000000000000000000000000000000') as Address,
    quoterV2: (process.env.NEXT_PUBLIC_BASE_QUOTER ||
      '0x0000000000000000000000000000000000000000') as Address,
  },
  // Base Sepolia (84532)
  [BASE_SEPOLIA_CHAIN_ID]: {
    weth: '0x4200000000000000000000000000000000000006' as Address,
    wbtc: '0x0000000000000000000000000000000000000000' as Address,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
    chainlinkEthUsd: '0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1' as Address,
    poolManager: '0x0000000000000000000000000000000000000000' as Address,
    venueAdapter: '0x0000000000000000000000000000000000000000' as Address,
    optionSettlementHook: '0xcb77AF9D41Df699ac24966B25bF1e504C66f00c8' as Address,
    vault: '0x0000000000000000000000000000000000000000' as Address,
    mockVenue: '0x0000000000000000000000000000000000000000' as Address,
    routeId: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
    positionManager: '0x0000000000000000000000000000000000000000' as Address,
    quoterV2: '0x0000000000000000000000000000000000000000' as Address,
  },
};

// ─── Viem Public Clients ──────────────────────────────────────────────────────

export const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'),
});

export const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'),
});

export function getPublicClient(chainId: number = BASE_CHAIN_ID) {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return baseSepoliaClient;
  return baseClient;
}

export function getBrowserWalletClient(chainId: number = BASE_CHAIN_ID): WalletClient | null {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    return null;
  }
  const targetChain = chainId === BASE_SEPOLIA_CHAIN_ID ? baseSepolia : base;
  return createWalletClient({
    chain: targetChain,
    transport: custom((window as any).ethereum),
  });
}

// ─── Contract ABIs ────────────────────────────────────────────────────────────

export const UniswapV4VenueAdapterAbi = [
  {
    name: 'swap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'routeId', type: 'bytes32' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'registerRoute',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'poolKeyOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'routeId', type: 'bytes32' }],
    outputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
] as const;

export const OptionSettlementHookAbi = [
  {
    name: 'knownPositionManagers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pm', type: 'address' }],
    outputs: [{ name: 'isKnown', type: 'bool' }],
  },
  {
    name: 'trustedAdapter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'addPositionManager',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionManager', type: 'address' }],
    outputs: [],
  },
] as const;

export const V4LiquidityVaultAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'extractForMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'manualRestake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [],
  },
  {
    name: 'pendingAsset',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const MockPriceOracleAbi = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    name: 'price',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'underlying', type: 'bytes32' }],
    outputs: [{ name: 'p', type: 'uint256' }],
  },
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'description',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'setPrice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'price_', type: 'uint256' },
      { name: 'updatedAt_', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export const ERC20Abi = [
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// ─── App Simulation Helpers ───────────────────────────────────────────────────

export interface MintSimulationResult {
  txHash: Hex;
  positionId: string;
  routeId: Hex;
  entryPrice: bigint;
  expiryTimestamp: number;
}

/**
 * Simulates or executes option position minting on elpi.xyz
 */
export async function simulateOptionMint(params: {
  routeId: Hex;
  units: number;
  durationHours: number;
  oraclePrice: number;
}): Promise<MintSimulationResult> {
  // Simulate delay for blockchain transaction submission
  await new Promise((resolve) => setTimeout(resolve, 800));

  const randomHash = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}` as Hex;

  const positionId = Math.floor(1000 + Math.random() * 9000).toString();
  const entryPrice = BigInt(Math.floor(params.oraclePrice * 1e6));
  const expiryTimestamp = Math.floor(Date.now() / 1000) + params.durationHours * 3600;

  return {
    txHash: randomHash,
    positionId,
    routeId: params.routeId,
    entryPrice,
    expiryTimestamp,
  };
}

export interface SettlementSimulationResult {
  txHash: Hex;
  payoutAmount: number;
  feeAmount: number;
  settlementVenueUsed: boolean;
}

/**
 * Simulates or executes settlement (taker payout or LP recovery)
 */
export async function simulateSettlement(params: {
  positionId: string;
  minPayout: number;
  isDirectLp: boolean;
  netPayout: number;
  protocolFee: number;
}): Promise<SettlementSimulationResult> {
  await new Promise((resolve) => setTimeout(resolve, 800));

  const randomHash = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}` as Hex;

  return {
    txHash: randomHash,
    payoutAmount: params.netPayout,
    feeAmount: params.protocolFee,
    settlementVenueUsed: true,
  };
}

/**
 * Subscribes to real-time PoolManager Swap events via WebSocket / RPC filter (§9.1)
 */
export function subscribeToPoolSwaps(
  poolId: Hex,
  onSwap: (swap: { sender: Address; amount0: bigint; amount1: bigint; sqrtPriceX96: bigint }) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  try {
    const unwatch = baseClient.watchContractEvent({
      address: CONTRACT_ADDRESSES[BASE_CHAIN_ID].poolManager,
      abi: [
        {
          anonymous: false,
          inputs: [
            { indexed: true, name: 'id', type: 'bytes32' },
            { indexed: true, name: 'sender', type: 'address' },
            { indexed: false, name: 'amount0', type: 'int128' },
            { indexed: false, name: 'amount1', type: 'int128' },
            { indexed: false, name: 'sqrtPriceX96', type: 'uint160' },
            { indexed: false, name: 'liquidity', type: 'uint128' },
            { indexed: false, name: 'tick', type: 'int24' },
            { indexed: false, name: 'fee', type: 'uint24' },
          ],
          name: 'Swap',
          type: 'event',
        },
      ],
      eventName: 'Swap',
      args: { id: poolId },
      onLogs: (logs) => {
        for (const log of logs) {
          const args = (log as any).args;
          if (args) {
            onSwap({
              sender: args.sender,
              amount0: BigInt(args.amount0 || 0),
              amount1: BigInt(args.amount1 || 0),
              sqrtPriceX96: BigInt(args.sqrtPriceX96 || 0),
            });
          }
        }
      },
    });
    return unwatch;
  } catch (err) {
    console.warn('Real-time swap subscription not active:', err);
    return () => {};
  }
}

