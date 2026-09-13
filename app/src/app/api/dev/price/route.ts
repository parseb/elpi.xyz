import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses } from "@/config/addresses";
import { anvilLocal } from "@/config/chain";
import { MockPriceOracleAbi } from "@/generated/abis/MockPriceOracle";
import { MockSettlementVenueAbi } from "@/generated/abis/MockSettlementVenue";

const INTERNAL_RPC = process.env.INTERNAL_RPC_URL || "http://127.0.0.1:8545";
const DEPLOYER_KEY: Hex =
  (process.env.DEPLOYER_KEY as Hex) ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const asset = (body.asset || "WETH").toUpperCase();
    const priceUsd = Number(body.priceUsd);

    if (!priceUsd || isNaN(priceUsd) || priceUsd <= 0) {
      return NextResponse.json(
        { error: "Invalid priceUsd (must be a positive number)" },
        { status: 400 }
      );
    }

    const account = privateKeyToAccount(DEPLOYER_KEY);
    const transport = http(INTERNAL_RPC);
    const publicClient = createPublicClient({ chain: anvilLocal, transport });
    const walletClient = createWalletClient({ account, chain: anvilLocal, transport });

    const isBtc = asset === "WBTC";
    const oracleAddr = (isBtc ? addresses.btcPriceOracle : addresses.priceOracle) as Address;
    const venueAddr = (isBtc ? addresses.btcSettlementVenue : addresses.settlementVenue) as Address;

    // Price normalized to 1e18
    const p18 = BigInt(Math.round(priceUsd * 1e6)) * 10n ** 12n;
    // Venue rate: numerator = p6 (for 6 decimal USDC), denominator = 1e18 for WETH or 1e8 for WBTC
    const p6 = BigInt(Math.round(priceUsd * 1e6));
    const denom = isBtc ? 10n ** 8n : 10n ** 18n;

    // Fetch current block timestamp so oracle updatedAt is strictly fresh
    const block = await publicClient.getBlock();
    const now = block.timestamp;

    const oracleTx = await walletClient.writeContract({
      address: oracleAddr,
      abi: MockPriceOracleAbi,
      functionName: "setPrice",
      args: [p18, now],
    });

    let venueTx: string | null = null;
    if (venueAddr && venueAddr !== "0x0000000000000000000000000000000000000000") {
      try {
        venueTx = await walletClient.writeContract({
          address: venueAddr,
          abi: MockSettlementVenueAbi,
          functionName: "setRate",
          args: [p6, denom],
        });
      } catch (err) {
        console.warn("MockSettlementVenue setRate warning:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      asset,
      priceUsd,
      price1e18: p18.toString(),
      oracleTx,
      venueTx,
      timestamp: Number(now),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
