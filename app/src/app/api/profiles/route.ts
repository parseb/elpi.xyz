import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  deserializeProfile,
  type SerializedSignedLiquidityProfile,
  type SignedLiquidityProfile,
} from "@/lib/liquidityProfile";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateLiquidityProfile, isProfileStale, verifyLiquidityProfileSignature } from "@/lib/profileValidation";

// GET /api/profiles — list profiles (filtered by status, collateral, lp)
// POST /api/profiles — insert a new signed profile (strictly validated against EIP-712 & staleness).

export async function GET(request: NextRequest) {
  // Enforce rate limiting: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, { limit: 60, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  const db = getDb();
  const searchParams = request.nextUrl.searchParams;
  const status = (searchParams.get("status") as "active" | "historical" | "all") || "active";
  const collateral = searchParams.get("collateral");
  const lp = searchParams.get("lp");

  const records = db.store.getProfiles({ status, collateral, lp });

  if (status === "historical") {
    const historicalProfiles = records.map((r) => JSON.parse(r.signed_blob) as SerializedSignedLiquidityProfile);
    return NextResponse.json({ profiles: historicalProfiles, count: historicalProfiles.length });
  }

  const activeProfiles: SerializedSignedLiquidityProfile[] = [];
  const invalidatedHashes: string[] = [];

  for (const r of records) {
    try {
      const serialized = JSON.parse(r.signed_blob) as SerializedSignedLiquidityProfile;
      const profile: SignedLiquidityProfile = deserializeProfile(serialized);

      // Check for staleness or invalid configuration
      const staleness = isProfileStale(profile);
      if (staleness.stale) {
        invalidatedHashes.push(r.profile_hash);
        continue;
      }

      // Verify cryptographic EIP-712 signature matches declared LP address
      const sigValid = await verifyLiquidityProfileSignature(profile);
      if (!sigValid) {
        invalidatedHashes.push(r.profile_hash);
        continue;
      }

      activeProfiles.push(serialized);
    } catch {
      invalidatedHashes.push(r.profile_hash);
    }
  }

  // Soft-delete expired or invalid profiles in SQLite
  if (invalidatedHashes.length > 0) {
    const updateStmt = db.prepare("UPDATE profiles SET invalidated = 1 WHERE profile_hash = ?");
    const markTx = db.transaction(() => {
      for (const hash of invalidatedHashes) {
        updateStmt.run(hash);
      }
    });
    markTx();
  }

  return NextResponse.json({ profiles: activeProfiles, count: activeProfiles.length });
}

export async function POST(request: NextRequest) {
  // Enforce rate limiting: 20 POST requests per minute
  const rateLimitResponse = checkRateLimit(request, { limit: 20, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  const db = getDb();
  try {
    const body = (await request.json()) as SerializedSignedLiquidityProfile;

    // Minimal shape validation
    if (!body.lp || !body.collateralAsset || !body.settlementAsset || !body.signature) {
      return NextResponse.json({ error: "Invalid profile payload shape" }, { status: 400 });
    }

    let profile: SignedLiquidityProfile;
    try {
      profile = deserializeProfile(body);
    } catch (err) {
      return NextResponse.json(
        { error: `Malformed numeric profile parameters: ${err instanceof Error ? err.message : "Deserialization error"}` },
        { status: 400 },
      );
    }

    // Comprehensive validation (EIP-712 signature + staleness & duration bounds)
    const validation = await validateLiquidityProfile(profile);
    if (!validation.valid) {
      return NextResponse.json({ error: `Liquidity profile rejected: ${validation.reason}` }, { status: 400 });
    }

    // Use lp+nonce+timestamp as deterministic hash key
    const profileHash = `${body.lp}-${body.nonce}-${body.timestamp}`;

    db.prepare(
      `INSERT OR REPLACE INTO profiles
       (profile_hash, lp, collateral, settlement, min_hours, max_hours, total_units, price_per_unit, option_type, signed_blob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      profileHash,
      body.lp,
      body.collateralAsset,
      body.settlementAsset,
      body.minHours,
      body.maxHours,
      body.totalUnits,
      body.pricePerUnitPerHour,
      body.supportsOptionType,
      JSON.stringify(body),
    );

    return NextResponse.json({ ok: true, hash: profileHash }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal Server Error" }, { status: 500 });
  }
}
