import { type Address, type Hex, hashTypedData } from "viem";
import { addresses } from "@/config/addresses";

// Mirrors src/PositionManager.sol's LIQUIDITY_PROFILE_TYPEHASH / EIP712 domain exactly
// (name "OptionCore", version "1") — verified byte-for-byte against the contract's own
// _hashProfile via a one-off Foundry script cross-check (viem's hashTypedData encodes the
// `chainIds: uint256[]` field the same way Solidity's `abi.encodePacked(uint256[])` does,
// so this is not an assumption). Do not reorder these fields — order is part of the type
// hash.
export const liquidityProfileDomain = {
  name: "OptionCore",
  version: "1",
  chainId: addresses.chainId,
  verifyingContract: addresses.positionManager,
} as const;

export const liquidityProfileTypes = {
  LiquidityProfile: [
    { name: "lp", type: "address" },
    { name: "collateralAsset", type: "address" },
    { name: "settlementAsset", type: "address" },
    { name: "minHours", type: "uint16" },
    { name: "maxHours", type: "uint16" },
    { name: "totalUnits", type: "uint256" },
    { name: "pricePerUnitPerHour", type: "uint256" },
    { name: "supportsOptionType", type: "uint8" },
    { name: "unitScalarNum", type: "uint256" },
    { name: "unitScalarDen", type: "uint256" },
    { name: "oracle", type: "address" },
    { name: "venue", type: "address" },
    { name: "arbiter", type: "address" },
    { name: "condition", type: "address" },
    { name: "routeId", type: "bytes32" },
    { name: "maxPriceAge", type: "uint32" },
    { name: "slippageBps", type: "uint16" },
    { name: "ackUnverifiedTerms", type: "bool" },
    { name: "chainIds", type: "uint256[]" },
    { name: "timestamp", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// 0 = CALL_ONLY, 1 = PUT_ONLY, 2 = BOTH (LiquidityProfile.sol's supportsOptionType).
export type OptionTypeSupport = 0 | 1 | 2;

/** The signable message shape (everything except `signature`, which is computed after). */
export interface LiquidityProfileMessage {
  lp: Address;
  collateralAsset: Address;
  settlementAsset: Address;
  minHours: number;
  maxHours: number;
  totalUnits: bigint;
  pricePerUnitPerHour: bigint;
  supportsOptionType: OptionTypeSupport;
  unitScalarNum: bigint;
  unitScalarDen: bigint;
  oracle: Address;
  venue: Address;
  arbiter: Address;
  condition: Address;
  routeId: Hex;
  maxPriceAge: number;
  slippageBps: number;
  ackUnverifiedTerms: boolean;
  chainIds: readonly bigint[];
  timestamp: bigint;
  nonce: bigint;
}

/** A signed profile, in the exact shape `IPositionManager.mint`'s calldata struct expects. */
export interface SignedLiquidityProfile extends LiquidityProfileMessage {
  signature: Hex;
}

export const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000".slice(
  0,
  66,
) as Hex;

/** JSON round-trips bigint as strings — this is the on-the-wire shape shared/exported/imported. */
export type SerializedSignedLiquidityProfile = {
  [K in keyof SignedLiquidityProfile]: SignedLiquidityProfile[K] extends bigint
    ? string
    : SignedLiquidityProfile[K] extends readonly bigint[]
      ? string[]
      : SignedLiquidityProfile[K];
};

export function serializeProfile(profile: SignedLiquidityProfile): SerializedSignedLiquidityProfile {
  return {
    ...profile,
    totalUnits: profile.totalUnits.toString(),
    pricePerUnitPerHour: profile.pricePerUnitPerHour.toString(),
    unitScalarNum: profile.unitScalarNum.toString(),
    unitScalarDen: profile.unitScalarDen.toString(),
    chainIds: profile.chainIds.map(String),
    timestamp: profile.timestamp.toString(),
    nonce: profile.nonce.toString(),
  };
}

export function deserializeProfile(raw: SerializedSignedLiquidityProfile): SignedLiquidityProfile {
  return {
    ...raw,
    totalUnits: BigInt(raw.totalUnits),
    pricePerUnitPerHour: BigInt(raw.pricePerUnitPerHour),
    unitScalarNum: BigInt(raw.unitScalarNum),
    unitScalarDen: BigInt(raw.unitScalarDen),
    chainIds: raw.chainIds.map(BigInt),
    timestamp: BigInt(raw.timestamp),
    nonce: BigInt(raw.nonce),
  };
}

/// The same digest PositionManager.consumedUnits is keyed by (mirrors hashBackerQuote in
/// backerQuote.ts) — needed so the market page can bulk-read remaining capacity for solo
/// profiles the same way it already does for router quotes.
export function hashLiquidityProfile(p: LiquidityProfileMessage): Hex {
  return hashTypedData({
    domain: liquidityProfileDomain,
    types: liquidityProfileTypes,
    primaryType: "LiquidityProfile",
    message: p,
  });
}
