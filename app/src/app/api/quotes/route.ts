import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  deserializeQuote,
  type SerializedSignedBackerQuote,
  type SignedBackerQuote,
} from "@/lib/backerQuote";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateBackerQuote, isQuoteStale, verifyBackerQuoteSignature } from "@/lib/profileValidation";

// GET /api/quotes — list backer quotes (filtered by status, collateral, backer)
// POST /api/quotes — insert a new signed backer quote (strictly validated against EIP-712 & staleness).

export async function GET(request: NextRequest) {
  // Enforce rate limiting: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, { limit: 60, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  const db = getDb();
  const searchParams = request.nextUrl.searchParams;
  const status = (searchParams.get("status") as "active" | "historical" | "all") || "active";
  const collateral = searchParams.get("collateral");
  const backer = searchParams.get("backer");

  const records = db.store.getQuotes({ status, collateral, backer });

  if (status === "historical") {
    const historicalQuotes = records.map((r) => JSON.parse(r.signed_blob) as SerializedSignedBackerQuote);
    return NextResponse.json({ quotes: historicalQuotes, count: historicalQuotes.length });
  }

  const activeQuotes: SerializedSignedBackerQuote[] = [];
  const invalidatedHashes: string[] = [];

  for (const r of records) {
    try {
      const serialized = JSON.parse(r.signed_blob) as SerializedSignedBackerQuote;
      const quote: SignedBackerQuote = deserializeQuote(serialized);

      const staleness = isQuoteStale(quote);
      if (staleness.stale) {
        invalidatedHashes.push(r.quote_hash);
        continue;
      }

      const sigValid = await verifyBackerQuoteSignature(quote);
      if (!sigValid) {
        invalidatedHashes.push(r.quote_hash);
        continue;
      }

      activeQuotes.push(serialized);
    } catch {
      invalidatedHashes.push(r.quote_hash);
    }
  }

  // Soft-delete invalid quotes in SQLite
  if (invalidatedHashes.length > 0) {
    const updateStmt = db.prepare("UPDATE quotes SET invalidated = 1 WHERE quote_hash = ?");
    const markTx = db.transaction(() => {
      for (const hash of invalidatedHashes) {
        updateStmt.run(hash);
      }
    });
    markTx();
  }

  return NextResponse.json({ quotes: activeQuotes, count: activeQuotes.length });
}

export async function POST(request: NextRequest) {
  // Enforce rate limiting: 20 POST requests per minute
  const rateLimitResponse = checkRateLimit(request, { limit: 20, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  const db = getDb();
  try {
    const body = (await request.json()) as SerializedSignedBackerQuote;

    if (!body.backer || !body.collateralAsset || !body.settlementAsset || !body.signature) {
      return NextResponse.json({ error: "Invalid quote payload shape" }, { status: 400 });
    }

    let quote: SignedBackerQuote;
    try {
      quote = deserializeQuote(body);
    } catch (err) {
      return NextResponse.json(
        { error: `Malformed numeric quote parameters: ${err instanceof Error ? err.message : "Deserialization error"}` },
        { status: 400 },
      );
    }

    // Comprehensive validation (EIP-712 signature + staleness & duration bounds)
    const validation = await validateBackerQuote(quote);
    if (!validation.valid) {
      return NextResponse.json({ error: `Backer quote rejected: ${validation.reason}` }, { status: 400 });
    }

    const quoteHash = `${body.backer}-${body.nonce}`;

    db.prepare(
      `INSERT OR REPLACE INTO quotes
       (quote_hash, backer, collateral, settlement, min_hours, max_hours, max_units, price_per_unit, option_type, signed_blob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      quoteHash,
      body.backer,
      body.collateralAsset,
      body.settlementAsset,
      body.minHours,
      body.maxHours,
      body.maxUnits,
      body.pricePerUnitPerHour,
      body.supportsOptionType,
      JSON.stringify(body),
    );

    return NextResponse.json({ ok: true, hash: quoteHash }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal Server Error" }, { status: 500 });
  }
}
