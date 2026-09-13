import { NextRequest, NextResponse } from "next/server";

const INTERNAL_RPC = process.env.INTERNAL_RPC_URL || "http://127.0.0.1:8545";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstreamRes = await fetch(INTERNAL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const data = await upstreamRes.text();
    return new NextResponse(data, {
      status: upstreamRes.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: `Devnet RPC Proxy Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      },
      { status: 502 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
