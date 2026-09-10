#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// End-to-end verification of take transaction on local Anvil devnet
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "app", "package.json"));

const { createPublicClient, createWalletClient, http, parseEventLogs, encodeFunctionData } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const CONFIG_PATH = path.join(ROOT, "local-anvil.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const PROFILES_PATH = path.join(ROOT, "app", "data", "profiles-store.json");
const store = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf-8"));

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
  console.log("=== Testing End-to-End Take Transaction ===");
  console.log("Taker address:", takerAccount.address);

  // Take the first profile: WETH Call, 1-24h
  const profileRecord = store.profiles[0];
  const p = JSON.parse(profileRecord.signed_blob);

  console.log("Profile LP:", p.lp);
  console.log("Profile Collateral:", p.collateralAsset);
  console.log("Profile Total Units:", p.totalUnits);
  console.log("Profile Price/Unit/Hr:", p.pricePerUnitPerHour);

  const unitsToTake = 50n; // 0.5 WETH
  const durationHours = 24;
  const premium = unitsToTake * BigInt(durationHours) * BigInt(p.pricePerUnitPerHour);
  console.log("Required premium (USDC):", Number(premium) / 1e6, "USDC");

  // Check taker USDC balance
  const usdcBal = await publicClient.readContract({
    address: p.settlementAsset,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [takerAccount.address],
  });
  console.log("Taker USDC Balance:", Number(usdcBal) / 1e6, "USDC");

  // Approve PositionManager
  console.log("Approving PositionManager...");
  const approveHash = await takerWallet.writeContract({
    address: p.settlementAsset,
    abi: MockERC20Abi,
    functionName: "approve",
    args: [config.contracts.positionManager, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("Approve receipt status:", approveReceipt.status);

  // Execute mint
  console.log("Executing PositionManager.mint()...");
  const profileParam = {
    lp: p.lp,
    collateralAsset: p.collateralAsset,
    settlementAsset: p.settlementAsset,
    minHours: Number(p.minHours),
    maxHours: Number(p.maxHours),
    totalUnits: BigInt(p.totalUnits),
    pricePerUnitPerHour: BigInt(p.pricePerUnitPerHour),
    supportsOptionType: Number(p.supportsOptionType),
    unitScalarNum: BigInt(p.unitScalarNum),
    unitScalarDen: BigInt(p.unitScalarDen),
    oracle: p.oracle,
    venue: p.venue,
    arbiter: p.arbiter,
    condition: p.condition,
    routeId: p.routeId,
    maxPriceAge: Number(p.maxPriceAge),
    slippageBps: Number(p.slippageBps),
    ackUnverifiedTerms: Boolean(p.ackUnverifiedTerms),
    chainIds: p.chainIds.map(BigInt),
    timestamp: BigInt(p.timestamp),
    nonce: BigInt(p.nonce),
    signature: p.signature,
  };

  const pointersParam = {
    oracle: p.oracle,
    venue: p.venue,
    arbiter: p.arbiter,
    condition: p.condition,
    routeId: p.routeId,
    maxPriceAge: Number(p.maxPriceAge),
    slippageBps: Number(p.slippageBps),
  };

  const mintHash = await takerWallet.writeContract({
    address: config.contracts.positionManager,
    abi: PositionManagerAbi,
    functionName: "mint",
    args: [
      profileParam,
      unitsToTake,
      durationHours,
      pointersParam,
      0, // Call
      false,
    ],
  });

  console.log("Mint transaction sent. Hash:", mintHash);
  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log("Mint receipt status:", mintReceipt.status);

  if (mintReceipt.status !== "success") {
    console.error("❌ Take transaction failed!");
    process.exit(1);
  }

  const events = parseEventLogs({
    abi: PositionManagerAbi,
    eventName: "PositionMinted",
    logs: mintReceipt.logs,
  });

  if (events.length === 0) {
    console.error("❌ PositionMinted event not found in receipt!");
    process.exit(1);
  }

  const mintedEvent = events[0];
  console.log("✔ Position minted successfully!");
  console.log("  Position ID :", mintedEvent.args.positionId.toString());
  console.log("  Account TBA :", mintedEvent.args.account);
  console.log("  Units       :", mintedEvent.args.economics.units.toString());
  console.log("  Collateral  :", Number(mintedEvent.args.economics.units) * 0.01, "WETH");
  console.log("  Entry Price :", Number(mintedEvent.args.economics.entryPrice) / 1e18, "USD");

  // Verify owner
  const owner = await publicClient.readContract({
    address: config.contracts.positionManager,
    abi: PositionManagerAbi,
    functionName: "ownerOf",
    args: [mintedEvent.args.positionId],
  });
  console.log("  NFT Owner   :", owner);
  if (owner.toLowerCase() !== takerAccount.address.toLowerCase()) {
    console.error("❌ Owner does not match taker!");
    process.exit(1);
  }

  console.log("🎉 All assertions passed cleanly!");
}

main().catch((err) => {
  console.error("Take transaction reverted with:", err);
  process.exit(1);
});
