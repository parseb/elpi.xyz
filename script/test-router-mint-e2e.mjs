#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// End-to-end verification of router quote take transaction on local Anvil devnet
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "app", "package.json"));

const { createPublicClient, createWalletClient, http, parseEventLogs } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const CONFIG_PATH = path.join(ROOT, "local-anvil.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const PROFILES_PATH = path.join(ROOT, "app", "data", "profiles-store.json");
const store = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf-8"));

const LPRouterAbi = require(path.join(ROOT, "app", "src", "generated", "abis", "LPRouter.ts")).LPRouterAbi;
const PositionManagerAbi = require(path.join(ROOT, "app", "src", "generated", "abis", "PositionManager.ts")).PositionManagerAbi;
const MockERC20Abi = require(path.join(ROOT, "app", "src", "generated", "abis", "MockERC20.ts")).MockERC20Abi;

const chain = {
  id: Number(config.chainId),
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
};

const publicClient = createPublicClient({ chain, transport: http() });

const ELPI2_KEY = "0xfdc6e5b4548767f71e2b7b835529510d49436a578dc5b57ede07a2be0866c0b4";
const takerAccount = privateKeyToAccount(ELPI2_KEY);
const takerWallet = createWalletClient({ account: takerAccount, chain, transport: http() });

async function main() {
  console.log("=== Testing End-to-End Router Take Transaction (matchAndMint) ===");
  console.log("Taker address:", takerAccount.address);

  // Take the first router quote
  const quoteRecord = store.quotes[0];
  const q = JSON.parse(quoteRecord.signed_blob);

  console.log("Quote Backer:", q.backer);
  console.log("Quote Collateral:", q.collateralAsset);
  console.log("Quote Max Units:", q.maxUnits);
  console.log("Quote Price/Unit/Hr:", q.pricePerUnitPerHour);

  const unitsToTake = 50n; // 0.5 WETH
  const durationHours = 24;
  const premium = unitsToTake * BigInt(durationHours) * BigInt(q.pricePerUnitPerHour);
  console.log("Required premium (USDC):", Number(premium) / 1e6, "USDC");

  // Approve LPRouter
  console.log("Approving LPRouter...");
  const approveHash = await takerWallet.writeContract({
    address: q.settlementAsset,
    abi: MockERC20Abi,
    functionName: "approve",
    args: [config.contracts.lpRouter, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("Approve receipt status:", approveReceipt.status);

  // Execute matchAndMint
  console.log("Executing LPRouter.matchAndMint()...");
  const quoteStruct = {
    backer: q.backer,
    collateralAsset: q.collateralAsset,
    settlementAsset: q.settlementAsset,
    minHours: Number(q.minHours),
    maxHours: Number(q.maxHours),
    maxUnits: BigInt(q.maxUnits),
    pricePerUnitPerHour: BigInt(q.pricePerUnitPerHour),
    supportsOptionType: Number(q.supportsOptionType),
    unitScalarNum: BigInt(q.unitScalarNum),
    unitScalarDen: BigInt(q.unitScalarDen),
    oracle: q.oracle,
    venue: q.venue,
    arbiter: q.arbiter,
    condition: q.condition,
    routeId: q.routeId,
    maxPriceAge: Number(q.maxPriceAge),
    slippageBps: Number(q.slippageBps),
    nonce: BigInt(q.nonce),
  };

  const allocations = [
    {
      quote: quoteStruct,
      units: unitsToTake,
      signature: q.signature,
    },
  ];

  const mintHash = await takerWallet.writeContract({
    address: config.contracts.lpRouter,
    abi: LPRouterAbi,
    functionName: "matchAndMint",
    args: [
      allocations,
      q.collateralAsset,
      q.settlementAsset,
      BigInt(q.unitScalarNum),
      BigInt(q.unitScalarDen),
      q.oracle,
      q.venue,
      q.arbiter,
      q.condition,
      q.routeId,
      Number(q.maxPriceAge),
      Number(q.slippageBps),
      durationHours,
      0, // Call
      false,
    ],
  });

  console.log("MatchAndMint transaction sent. Hash:", mintHash);
  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log("MatchAndMint receipt status:", mintReceipt.status);

  if (mintReceipt.status !== "success") {
    console.error("❌ Router take transaction failed!");
    process.exit(1);
  }

  const events = parseEventLogs({
    abi: LPRouterAbi,
    eventName: "PositionMatched",
    logs: mintReceipt.logs,
  });

  if (events.length === 0) {
    console.error("❌ PositionMatched event not found in receipt!");
    process.exit(1);
  }

  const matchedEvent = events[0];
  console.log("✔ Position matched successfully!");
  console.log("  Position ID :", matchedEvent.args.positionId.toString());
  console.log("  Account TBA :", matchedEvent.args.account);
  console.log("  Taker       :", matchedEvent.args.taker);

  // Verify owner of NFT
  const owner = await publicClient.readContract({
    address: config.contracts.positionManager,
    abi: PositionManagerAbi,
    functionName: "ownerOf",
    args: [matchedEvent.args.positionId],
  });
  console.log("  NFT Owner   :", owner);
  if (owner.toLowerCase() !== takerAccount.address.toLowerCase()) {
    console.error("❌ Owner does not match taker!");
    process.exit(1);
  }

  console.log("🎉 All router assertions passed cleanly!");
}

main().catch((err) => {
  console.error("Router take transaction reverted with:", err);
  process.exit(1);
});
