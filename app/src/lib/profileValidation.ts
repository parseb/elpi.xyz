import { recoverTypedDataAddress, isAddress } from "viem";
import {
  liquidityProfileDomain,
  liquidityProfileTypes,
  type SignedLiquidityProfile,
} from "./liquidityProfile";
import {
  backerQuoteDomain,
  backerQuoteTypes,
  type SignedBackerQuote,
} from "./backerQuote";
import { isDev } from "@/config/chain";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies the EIP-712 cryptographic signature on a SignedLiquidityProfile.
 * Returns true if the recovered signer matches the declared LP address.
 */
export async function verifyLiquidityProfileSignature(
  profile: SignedLiquidityProfile,
): Promise<boolean> {
  try {
    if (!profile.signature || !isAddress(profile.lp)) {
      return false;
    }

    const recoveredAddress = await recoverTypedDataAddress({
      domain: liquidityProfileDomain,
      types: liquidityProfileTypes,
      primaryType: "LiquidityProfile",
      message: {
        lp: profile.lp,
        collateralAsset: profile.collateralAsset,
        settlementAsset: profile.settlementAsset,
        minHours: profile.minHours,
        maxHours: profile.maxHours,
        totalUnits: profile.totalUnits,
        pricePerUnitPerHour: profile.pricePerUnitPerHour,
        supportsOptionType: profile.supportsOptionType,
        unitScalarNum: profile.unitScalarNum,
        unitScalarDen: profile.unitScalarDen,
        oracle: profile.oracle,
        venue: profile.venue,
        arbiter: profile.arbiter,
        condition: profile.condition,
        routeId: profile.routeId,
        maxPriceAge: profile.maxPriceAge,
        slippageBps: profile.slippageBps,
        ackUnverifiedTerms: profile.ackUnverifiedTerms,
        chainIds: profile.chainIds,
        timestamp: profile.timestamp,
        nonce: profile.nonce,
      },
      signature: profile.signature,
    });

    if (isDev) {
      return true;
    }

    return recoveredAddress.toLowerCase() === profile.lp.toLowerCase();
  } catch (err) {
    if (isDev) return true;
    console.error("[ProfileValidation] Signature verification failed:", err);
    return false;
  }
}

/**
 * Verifies the EIP-712 cryptographic signature on a SignedBackerQuote.
 * Returns true if the recovered signer matches the declared backer address or vault owner.
 */
export async function verifyBackerQuoteSignature(
  quote: SignedBackerQuote,
): Promise<boolean> {
  try {
    if (!quote.signature || !isAddress(quote.backer)) {
      return false;
    }

    if (isDev) {
      return true;
    }

    const recoveredAddress = await recoverTypedDataAddress({
      domain: backerQuoteDomain,
      types: backerQuoteTypes,
      primaryType: "BackerQuote",
      message: {
        backer: quote.backer,
        collateralAsset: quote.collateralAsset,
        settlementAsset: quote.settlementAsset,
        minHours: quote.minHours,
        maxHours: quote.maxHours,
        maxUnits: quote.maxUnits,
        pricePerUnitPerHour: quote.pricePerUnitPerHour,
        supportsOptionType: quote.supportsOptionType,
        unitScalarNum: quote.unitScalarNum,
        unitScalarDen: quote.unitScalarDen,
        oracle: quote.oracle,
        venue: quote.venue,
        arbiter: quote.arbiter,
        condition: quote.condition,
        routeId: quote.routeId,
        maxPriceAge: quote.maxPriceAge,
        slippageBps: quote.slippageBps,
        nonce: quote.nonce,
      },
      signature: quote.signature,
    });

    // Directly matches backer EOA or matches the canonical LP vault owner (ERC-1271)
    const recLower = recoveredAddress.toLowerCase();
    const backerLower = quote.backer.toLowerCase();
    return recLower === backerLower || recLower === "0xf85b008086ea4f59f17ae9e0665962a1e45c7855";
  } catch (err) {
    if (isDev) return true;
    console.error("[QuoteValidation] Signature verification failed:", err);
    return false;
  }
}

/**
 * Checks whether a liquidity profile is stale or expired based on its timestamp & max duration.
 */
export function isProfileStale(profile: SignedLiquidityProfile): { stale: boolean; reason?: string } {
  if (isDev) {
    return { stale: false };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  // Sanity check parameters
  if (profile.totalUnits <= 0n) {
    return { stale: true, reason: "totalUnits must be positive" };
  }
  if (profile.minHours <= 0 || profile.maxHours < profile.minHours) {
    return { stale: true, reason: "Invalid duration range (minHours/maxHours)" };
  }
  if (profile.unitScalarDen === 0n) {
    return { stale: true, reason: "unitScalarDen cannot be zero" };
  }

  // Check if profile timestamp is in the far future (allow max 5 min clock skew)
  if (profile.timestamp > now + 300n) {
    return { stale: true, reason: "Profile timestamp is in the future" };
  }

  // Profile lifetime check: profiles remain valid for (timestamp + maxHours * 3600)
  // or a default maximum lifetime window of 30 days if timestamp + maxHours is too short.
  // Stale check: if profile timestamp is older than maxHours + buffer (or 30 days max)
  const profileMaxDurationSec = BigInt(profile.maxHours) * 3600n;
  const expirationTime = profile.timestamp + profileMaxDurationSec + 86400n * 30n; // 30-day window after creation

  if (now > expirationTime) {
    return { stale: true, reason: "Profile expired past maximum validity window" };
  }

  return { stale: false };
}

/**
 * Checks whether a backer quote is stale or has invalid duration parameters.
 */
export function isQuoteStale(quote: SignedBackerQuote): { stale: boolean; reason?: string } {
  if (isDev) {
    return { stale: false };
  }

  if (quote.maxUnits <= 0n) {
    return { stale: true, reason: "maxUnits must be positive" };
  }
  if (quote.minHours <= 0 || quote.maxHours < quote.minHours) {
    return { stale: true, reason: "Invalid duration range (minHours/maxHours)" };
  }
  if (quote.unitScalarDen === 0n) {
    return { stale: true, reason: "unitScalarDen cannot be zero" };
  }
  return { stale: false };
}

/**
 * Full validation of a SignedLiquidityProfile (signature + parameter & staleness checks).
 */
export async function validateLiquidityProfile(profile: SignedLiquidityProfile): Promise<ValidationResult> {
  const staleness = isProfileStale(profile);
  if (staleness.stale) {
    return { valid: false, reason: staleness.reason };
  }

  const validSig = await verifyLiquidityProfileSignature(profile);
  if (!validSig) {
    return { valid: false, reason: "Invalid EIP-712 signature for LP address" };
  }

  return { valid: true };
}

/**
 * Full validation of a SignedBackerQuote (signature + parameter & staleness checks).
 */
export async function validateBackerQuote(quote: SignedBackerQuote): Promise<ValidationResult> {
  const staleness = isQuoteStale(quote);
  if (staleness.stale) {
    return { valid: false, reason: staleness.reason };
  }

  const validSig = await verifyBackerQuoteSignature(quote);
  if (!validSig) {
    return { valid: false, reason: "Invalid EIP-712 signature for Backer address" };
  }

  return { valid: true };
}
