import { type Address, type Hex, hashTypedData } from "viem";
import { addresses } from "@/config/addresses";
import { ZERO_BYTES32, type OptionTypeSupport } from "./liquidityProfile";

// Mirrors src/interfaces/ILPRouter.sol's BackerQuote struct and src/libraries/
// BackerQuoteLib.sol's EIP-712 domain/type exactly — verified byte-for-byte end-to-end
// against the real (post-fix) LPRouter.matchAndMint on the local devnet (a signed quote
// built with this exact encoding was accepted on-chain). Note the domain's
// verifyingContract is the ROUTER's address, not PositionManager's — a BackerQuote is
// checked by LPRouter directly, never by PositionManager (unlike LiquidityProfile).
export const backerQuoteDomain = {
  name: "OptionCore",
  version: "1",
  chainId: addresses.chainId,
  verifyingContract: addresses.lpRouter,
} as const;

export const backerQuoteTypes = {
  BackerQuote: [
    { name: "backer", type: "address" },
    { name: "collateralAsset", type: "address" },
    { name: "settlementAsset", type: "address" },
    { name: "minHours", type: "uint16" },
    { name: "maxHours", type: "uint16" },
    { name: "maxUnits", type: "uint256" },
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
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface BackerQuoteMessage {
  backer: Address;
  collateralAsset: Address;
  settlementAsset: Address;
  minHours: number;
  maxHours: number;
  maxUnits: bigint;
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
  nonce: bigint;
}

export interface SignedBackerQuote extends BackerQuoteMessage {
  signature: Hex;
}

export type SerializedSignedBackerQuote = {
  [K in keyof Omit<SignedBackerQuote, "maxUnits" | "pricePerUnitPerHour" | "unitScalarNum" | "unitScalarDen" | "nonce">]: SignedBackerQuote[K];
} & {
  maxUnits: string;
  pricePerUnitPerHour: string;
  unitScalarNum: string;
  unitScalarDen: string;
  nonce: string;
};

export function serializeQuote(q: SignedBackerQuote): SerializedSignedBackerQuote {
  return {
    ...q,
    maxUnits: q.maxUnits.toString(),
    pricePerUnitPerHour: q.pricePerUnitPerHour.toString(),
    unitScalarNum: q.unitScalarNum.toString(),
    unitScalarDen: q.unitScalarDen.toString(),
    nonce: q.nonce.toString(),
  };
}

export function deserializeQuote(raw: SerializedSignedBackerQuote): SignedBackerQuote {
  return {
    ...raw,
    maxUnits: BigInt(raw.maxUnits),
    pricePerUnitPerHour: BigInt(raw.pricePerUnitPerHour),
    unitScalarNum: BigInt(raw.unitScalarNum),
    unitScalarDen: BigInt(raw.unitScalarDen),
    nonce: BigInt(raw.nonce),
  };
}

/// The same digest LPRouter.consumedUnitsForQuote is keyed by — confirmed on-chain (a quote
/// signed with this exact hashTypedData call was accepted by the real, deployed
/// LPRouter.matchAndMint, which only succeeds if this hash matches BackerQuoteLib.digest
/// exactly, since ECDSA verification requires an exact digest match).
export function hashBackerQuote(q: BackerQuoteMessage): Hex {
  return hashTypedData({
    domain: backerQuoteDomain,
    types: backerQuoteTypes,
    primaryType: "BackerQuote",
    message: q,
  });
}

export { ZERO_BYTES32 };
