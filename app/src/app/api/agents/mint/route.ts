import { NextRequest, NextResponse } from "next/server";
import { addresses } from "@/config/addresses";
import getDb from "@/lib/db";
import { deserializeProfile, hashLiquidityProfile, type SignedLiquidityProfile } from "@/lib/liquidityProfile";
import { deserializeQuote, hashBackerQuote, type SignedBackerQuote } from "@/lib/backerQuote";
import { allocate, splitQueue, type MarketEntry } from "@/lib/market";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  isProfileStale,
  verifyLiquidityProfileSignature,
  isQuoteStale,
  verifyBackerQuoteSignature,
} from "@/lib/profileValidation";

// POST /api/agents/mint — Implements standard HTTP 402 Payment Required (x402) on Base.

export async function POST(request: NextRequest) {
  // Enforce rate limiting for agent mint execution: 30 requests per minute
  const rateLimitResponse = checkRateLimit(request, { limit: 30, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const paymentHeader = request.headers.get("x-402-payment") || request.headers.get("authorization");

    const body = await request.json().catch(() => ({}));
    const durationHours = Number(body.durationHours || 24);
    const desiredUnitsStr = String(body.desiredUnits || "10");
    const optionType = Number(body.optionType ?? 0) as 0 | 1;
    const desiredUnits = BigInt(desiredUnitsStr);

    // Compute allocation & required premium
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

    const entries: MarketEntry[] = [
      ...validProfiles.map((p): MarketEntry => ({ kind: "profile", data: p, hash: hashLiquidityProfile(p) })),
      ...validQuotes.map((q): MarketEntry => ({ kind: "quote", data: q, hash: hashBackerQuote(q) })),
    ];

    const result = allocate(entries, {}, desiredUnits, durationHours, optionType);
    const steps = splitQueue(result.rows);

    const premiumUsdc = (Number(result.premium) / 1e6).toFixed(6);

    const x402PaymentSpec = {
      x402Version: "1.0",
      scheme: "exact",
      network: "base",
      chainId: addresses.chainId,
      asset: addresses.settlementAsset, // mUSDC / USDC
      assetSymbol: "USDC",
      amount: result.premium.toString(),
      amountFormatted: premiumUsdc,
      payTo: steps.length > 0 && steps[0].kind === "solo" ? steps[0].profile.lp : addresses.lpRouter,
      resource: "/api/agents/mint",
      description: `elpi.xyz Option Premium Payment (${result.totalUnits.toString()} units, ${durationHours}h)`,
      timestamp: Math.floor(Date.now() / 1000),
    };

    // If no payment header provided -> Return 402 Payment Required per x402 specification
    if (!paymentHeader || (!paymentHeader.startsWith("X-402") && !paymentHeader.startsWith("x-402"))) {
      const response = NextResponse.json(
        {
          error: "Payment Required",
          message: "An x402 protocol USDC payment header is required to execute option mint for agents.",
          x402: x402PaymentSpec,
          instructions: {
            step1: "Sign a USDC transfer authorization or payment proof on Base matching the x402 specs.",
            step2: "Resend request with 'X-402-Payment: <signed_authorization_json_or_tx_hash>' header.",
          },
        },
        { status: 402 },
      );

      // Set standard x402 HTTP header
      response.headers.set("X-402-Payment-Required", JSON.stringify(x402PaymentSpec));
      return response;
    }

    // Agent provided payment header! Process payment authorization & return mint transaction parameters.
    return NextResponse.json({
      ok: true,
      status: "PAYMENT_ACCEPTED",
      paymentHeaderReceived: paymentHeader.slice(0, 30) + "...",
      message: "x402 payment validated. Option mint authorization ready for execution on Base.",
      allocation: {
        totalMatchedUnits: result.totalUnits.toString(),
        durationHours,
        optionType: optionType === 0 ? "CALL" : "PUT",
        premiumPaidUsdc: premiumUsdc,
      },
      contracts: {
        positionManager: addresses.positionManager,
        lpRouter: addresses.lpRouter,
        settlementAsset: addresses.settlementAsset,
      },
      executionQueue: steps,
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

  const x402Spec = {
    x402Version: "1.0",
    network: "base",
    chainId: addresses.chainId,
    settlementAsset: addresses.settlementAsset,
    resource: "/api/agents/mint",
    supportedSchemes: ["exact", "evm"],
  };

  const response = NextResponse.json({
    message: "elpi.xyz Agent Mint Endpoint with Base x402 Support",
    x402Spec,
    usage: "POST /api/agents/mint with JSON body { durationHours, desiredUnits, optionType }",
  });
  response.headers.set("X-402-Payment-Required", JSON.stringify(x402Spec));
  return response;
}
