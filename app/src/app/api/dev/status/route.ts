import { NextResponse } from "next/server";
import { createPublicClient, http, formatUnits } from "viem";
import { addresses } from "@/config/addresses";
import { anvilLocal } from "@/config/chain";
import { MockPriceOracleAbi } from "@/generated/abis/MockPriceOracle";

const INTERNAL_RPC = process.env.INTERNAL_RPC_URL || "http://127.0.0.1:8545";

export async function GET() {
  try {
    const publicClient = createPublicClient({ chain: anvilLocal, transport: http(INTERNAL_RPC) });
    const block = await publicClient.getBlock();

    let wethPrice = "0";
    let wethUpdatedAt = 0;
    try {
      const res = await publicClient.readContract({
        address: addresses.priceOracle,
        abi: MockPriceOracleAbi,
        functionName: "mockPrice",
      });
      wethPrice = formatUnits(res, 18);
      const updated = await publicClient.readContract({
        address: addresses.priceOracle,
        abi: MockPriceOracleAbi,
        functionName: "mockUpdatedAt",
      });
      wethUpdatedAt = Number(updated);
    } catch {}

    let wbtcPrice = "0";
    let wbtcUpdatedAt = 0;
    try {
      const res = await publicClient.readContract({
        address: addresses.btcPriceOracle,
        abi: MockPriceOracleAbi,
        functionName: "mockPrice",
      });
      wbtcPrice = formatUnits(res, 18);
      const updated = await publicClient.readContract({
        address: addresses.btcPriceOracle,
        abi: MockPriceOracleAbi,
        functionName: "mockUpdatedAt",
      });
      wbtcUpdatedAt = Number(updated);
    } catch {}

    return NextResponse.json({
      ok: true,
      blockNumber: Number(block.number),
      timestamp: Number(block.timestamp),
      isoDate: new Date(Number(block.timestamp) * 1000).toISOString(),
      weth: {
        priceUsd: Number(wethPrice).toFixed(2),
        updatedAt: wethUpdatedAt,
        ageSeconds: Number(block.timestamp) - wethUpdatedAt,
      },
      wbtc: {
        priceUsd: Number(wbtcPrice).toFixed(2),
        updatedAt: wbtcUpdatedAt,
        ageSeconds: Number(block.timestamp) - wbtcUpdatedAt,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
