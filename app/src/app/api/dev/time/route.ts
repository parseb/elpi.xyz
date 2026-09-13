import { NextRequest, NextResponse } from "next/server";

const INTERNAL_RPC = process.env.INTERNAL_RPC_URL || "http://127.0.0.1:8545";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let seconds = Number(body.seconds || 0);

    if (body.preset === "+1h") seconds = 3600;
    else if (body.preset === "+24h" || body.preset === "+1d") seconds = 86400;
    else if (body.preset === "+7d") seconds = 7 * 86400;

    if (!seconds || isNaN(seconds)) {
      return NextResponse.json({ error: "Invalid seconds or preset (+1h, +24h, +7d)" }, { status: 400 });
    }

    // Call evm_increaseTime
    const increaseRes = await fetch(INTERNAL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [seconds],
        id: 1,
      }),
    });
    const increaseData = await increaseRes.json();
    if (increaseData.error) {
      return NextResponse.json({ error: increaseData.error.message }, { status: 500 });
    }

    // Call evm_mine
    await fetch(INTERNAL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [],
        id: 2,
      }),
    });

    // Get new block timestamp
    const blockRes = await fetch(INTERNAL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: ["latest", false],
        id: 3,
      }),
    });
    const blockData = await blockRes.json();
    const newTimestamp = parseInt(blockData.result?.timestamp || "0", 16);

    return NextResponse.json({
      ok: true,
      secondsAdvanced: seconds,
      timestamp: newTimestamp,
      isoDate: new Date(newTimestamp * 1000).toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
