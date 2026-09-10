import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { deserializeProfile, hashLiquidityProfile, type SignedLiquidityProfile } from "@/lib/liquidityProfile";
import { deserializeQuote, hashBackerQuote, type SignedBackerQuote } from "@/lib/backerQuote";
import { allocate, splitQueue, type MarketEntry } from "@/lib/market";
import { addresses } from "@/config/addresses";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  isProfileStale,
  verifyLiquidityProfileSignature,
  isQuoteStale,
  verifyBackerQuoteSignature,
} from "@/lib/profileValidation";

// POST /api/agents/allocate — Programmatic allocation endpoint for autonomous AI agents (e.g. Clawd).
// Given duration, desired units, option type, and optional collateral asset, computes optimal liquidity match,
// premium calculation, and returns standard Base x402 payment specifications.

export async function POST(request: NextRequest) {
  // Enforce rate limiting for agent allocation: 30 requests per minute
  const rateLimitResponse = checkRateLimit(request, { limit: 30, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const durationHours = Number(body.durationHours || 24);
    const desiredUnitsStr = String(body.desiredUnits || "10");
    const optionType = Number(body.optionType ?? 0) as 0 | 1;
    const collateralAsset = body.collateralAsset?.toLowerCase();

    const desiredUnits = BigInt(desiredUnitsStr);

    if (durationHours <= 0 || desiredUnits <= 0n) {
      return NextResponse.json(
        { error: "Invalid durationHours or desiredUnits" },
        { status: 400 },
      );
    }

    const db = getDb();
    const profileRows = db.prepare("SELECT signed_blob FROM profiles WHERE invalidated = 0").all() as { signed_blob: string }[];
    const quoteRows = db.prepare("SELECT signed_blob FROM quotes WHERE invalidated = 0").all() as { signed_blob: string }[];

    const rawProfiles: SignedLiquidityProfile[] = profileRows.map((r) => deserializeProfile(JSON.parse(r.signed_blob)));
    const rawQuotes: SignedBackerQuote[] = quoteRows.map((r) => deserializeQuote(JSON.parse(r.signed_blob)));

    // Filter out stale or invalid profile entries before liquidity matching
    const validProfiles: SignedLiquidityProfile[] = [];
    for (const p of rawProfiles) {
      if (!isProfileStale(p).stale && (await verifyLiquidityProfileSignature(p))) {
        validProfiles.push(p);
      }
    }

    // Filter out stale or invalid quote entries before liquidity matching
    const validQuotes: SignedBackerQuote[] = [];
    for (const q of rawQuotes) {
      if (!isQuoteStale(q).stale && (await verifyBackerQuoteSignature(q))) {
        validQuotes.push(q);
      }
    }

    let entries: MarketEntry[] = [
      ...validProfiles.map((p): MarketEntry => ({ kind: "profile", data: p, hash: hashLiquidityProfile(p) })),
      ...validQuotes.map((q): MarketEntry => ({ kind: "quote", data: q, hash: hashBackerQuote(q) })),
    ];

    if (collateralAsset) {
      entries = entries.filter((e) => e.data.collateralAsset.toLowerCase() === collateralAsset);
    }

    const result = allocate(entries, {}, desiredUnits, durationHours, optionType);
    const steps = splitQueue(result.rows);

    const premiumUsdc = (Number(result.premium) / 1e6).toFixed(6);

    // Construct Base x402 payment spec for this option allocation
    const x402Details = {
      x402Version: "1.0",
      scheme: "exact",
      network: "base",
      chainId: addresses.chainId,
      asset: addresses.settlementAsset, // mUSDC / USDC
      assetSymbol: "USDC",
      amount: result.premium.toString(),
      amountFormatted: premiumUsdc,
      payTo: steps.length > 0 && steps[0].kind === "solo" ? steps[0].profile.lp : addresses.lpRouter,
      description: `elpi.xyz Premium Payment for ${result.totalUnits.toString()} option units (${durationHours}h, ${optionType === 0 ? "CALL" : "PUT"})`,
    };

    return NextResponse.json({
      ok: true,
      protocol: "elpi.xyz",
      targetChain: "Base",
      allocation: {
        desiredUnits: desiredUnits.toString(),
        totalMatchedUnits: result.totalUnits.toString(),
        shortfall: result.shortfall.toString(),
        durationHours,
        optionType: optionType === 0 ? "CALL" : "PUT",
        optionTypeId: optionType,
        totalPremiumUsdc: premiumUsdc,
        totalPremiumRaw: result.premium.toString(),
        stepCount: steps.length,
      },
      x402Details,
      executionSteps: steps.map((s, idx) => ({
        stepIndex: idx + 1,
        kind: s.kind,
        units: s.kind === "solo" ? s.units.toString() : s.rows.reduce((acc, r) => acc + r.units, 0n).toString(),
        contractTarget: s.kind === "solo" ? addresses.positionManager : addresses.lpRouter,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, { limit: 60, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  return NextResponse.json({
    message: "elpi.xyz Agent Allocation Endpoint (Base x402 Ready)",
    usage: "POST /api/agents/allocate with JSON body { durationHours, desiredUnits, optionType, collateralAsset }",
    x402Supported: true,
    network: "Base",
  });
}
