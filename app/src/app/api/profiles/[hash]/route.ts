import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";

// DELETE /api/profiles/[hash] — soft-delete (mark historical) or hard-delete (?hard=true) a profile by its hash.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const rateLimitResponse = checkRateLimit(request, { limit: 30, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  const db = getDb();
  const { hash } = await params;
  const hard = request.nextUrl.searchParams.get("hard") === "true";

  const result = hard
    ? db.store.deleteProfile(hash)
    : db.store.invalidateProfile(hash);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: hard, status: hard ? "deleted" : "historical" });
}

// PATCH /api/profiles/[hash] — update status (active vs historical)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const rateLimitResponse = checkRateLimit(request, { limit: 30, windowMs: 60_000 });
  if (rateLimitResponse) return rateLimitResponse;

  const db = getDb();
  const { hash } = await params;

  try {
    const body = await request.json();
    const status = body.status as "active" | "historical";
    if (status !== "active" && status !== "historical") {
      return NextResponse.json({ error: "Invalid status. Must be 'active' or 'historical'." }, { status: 400 });
    }

    const result = db.store.setProfileStatus(hash, status);
    if (result.changes === 0) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
