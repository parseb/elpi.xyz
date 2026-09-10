import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";

// POST /api/seed — bulk-insert seed profiles and quotes from script/seed-liquidity.sh.
// Replaces the old approach of writing a static seed-liquidity.json to app/public/.

export async function POST(request: NextRequest) {
  // Enforce rate limiting for seed endpoint: 10 requests per minute
  const rateLimitResponse = checkRateLimit(request, { limit: 10, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  const db = getDb();
  try {
    const body = (await request.json()) as {
      profiles?: Record<string, unknown>[];
      quotes?: Record<string, unknown>[];
    };

    const insertProfile = db.prepare(
      `INSERT OR REPLACE INTO profiles
       (profile_hash, lp, collateral, settlement, min_hours, max_hours, total_units, price_per_unit, option_type, signed_blob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertQuote = db.prepare(
      `INSERT OR REPLACE INTO quotes
       (quote_hash, backer, collateral, settlement, min_hours, max_hours, max_units, price_per_unit, option_type, signed_blob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let profileCount = 0;
    let quoteCount = 0;

    const insertAll = db.transaction(() => {
      db.exec("DELETE FROM profiles; DELETE FROM quotes;");
      for (const p of body.profiles ?? []) {
        const hash = `${p.lp}-${p.nonce}-${p.timestamp}`;
        insertProfile.run(
          hash,
          p.lp,
          p.collateralAsset,
          p.settlementAsset,
          p.minHours,
          p.maxHours,
          String(p.totalUnits),
          String(p.pricePerUnitPerHour),
          p.supportsOptionType,
          JSON.stringify(p),
        );
        profileCount++;
      }

      for (const q of body.quotes ?? []) {
        const hash = `${q.backer}-${q.nonce}`;
        insertQuote.run(
          hash,
          q.backer,
          q.collateralAsset,
          q.settlementAsset,
          q.minHours,
          q.maxHours,
          String(q.maxUnits),
          String(q.pricePerUnitPerHour),
          q.supportsOptionType,
          JSON.stringify(q),
        );
        quoteCount++;
      }
    });

    insertAll();

    return NextResponse.json({ ok: true, profileCount, quoteCount }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
