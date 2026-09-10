#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Generates realistic, scaled liquidity profiles & backer quotes signed via EIP-712
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "app", "package.json"));

const { privateKeyToAccount } = require("viem/accounts");

const CONFIG_PATH = path.join(ROOT, "local-anvil.json");
if (!fs.existsSync(CONFIG_PATH)) {
  console.error("local-anvil.json not found! Please run devnet deployment first.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const chainId = BigInt(config.chainId || 31337);
const tokens = config.tokens;
const contracts = config.contracts;
const accounts = config.accounts;
const settlementVenue = contracts.mockSettlementVenue || contracts.venue || contracts.venueAdapter;

const ELPI1_KEY = "0xb9912f8133b56bb35ebf2baf7a62faa21e0c30f865c4e9abc599aab8bcb7e7fa";
const lpAccount = privateKeyToAccount(ELPI1_KEY);

console.log("=== Generating EIP-712 Signed Profiles & Quotes ===");
console.log("  Chain ID       :", chainId.toString());
console.log("  LP Signer      :", lpAccount.address);
console.log("  PositionManager:", contracts.positionManager);
console.log("  LPRouter       :", contracts.lpRouter);
console.log("  V4 Vault       :", contracts.v4LiquidityVault);
console.log("  Venue          :", settlementVenue);

const liquidityProfileDomain = {
  name: "OptionCore",
  version: "1",
  chainId,
  verifyingContract: contracts.positionManager,
};

const liquidityProfileTypes = {
  LiquidityProfile: [
    { name: "lp", type: "address" },
    { name: "collateralAsset", type: "address" },
    { name: "settlementAsset", type: "address" },
    { name: "minHours", type: "uint16" },
    { name: "maxHours", type: "uint16" },
    { name: "totalUnits", type: "uint256" },
    { name: "pricePerUnitPerHour", type: "uint256" },
    { name: "supportsOptionType", type: "uint8" },
    { name: "unitScalarNum", type: "uint256" },
    { name: "unitScalarDen", type: "uint256" },
    { name: "oracle", type: "address" },
    { name: "venue", type: "address" },
    { name: "arbiter", type: "address" },
    { name: "condition", type: "address" },
    { name: "routeId", type: "bytes32" },
    { name: "maxPriceAge", type: "uint32" },
    { name: "slippageBps", type: "uint16" },
    { name: "ackUnverifiedTerms", type: "bool" },
    { name: "chainIds", type: "uint256[]" },
    { name: "timestamp", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

const backerQuoteDomain = {
  name: "OptionCore",
  version: "1",
  chainId,
  verifyingContract: contracts.lpRouter,
};

const backerQuoteTypes = {
  BackerQuote: [
    { name: "backer", type: "address" },
    { name: "collateralAsset", type: "address" },
    { name: "settlementAsset", type: "address" },
    { name: "minHours", type: "uint16" },
    { name: "maxHours", type: "uint16" },
    { name: "maxUnits", type: "uint256" },
    { name: "pricePerUnitPerHour", type: "uint256" },
    { name: "supportsOptionType", type: "uint8" },
    { name: "unitScalarNum", type: "uint256" },
    { name: "unitScalarDen", type: "uint256" },
    { name: "oracle", type: "address" },
    { name: "venue", type: "address" },
    { name: "arbiter", type: "address" },
    { name: "condition", type: "address" },
    { name: "routeId", type: "bytes32" },
    { name: "maxPriceAge", type: "uint32" },
    { name: "slippageBps", type: "uint16" },
    { name: "nonce", type: "uint256" },
  ],
};

const now = Math.floor(Date.now() / 1000);
const authorizedChains = [chainId, 8453n, 31337n];

// Realistic profile specifications scaled to 25 WETH staged liquidity
const profileSpecs = [
  // WETH Profiles (1 unit = 0.01 WETH)
  // 1. WETH Call, 1-24h, 300 units (3.0 WETH), rate: 5,000 raw USDC ($12/day per ETH)
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 1,
    maxHours: 24,
    totalUnits: 300n,
    pricePerUnitPerHour: 5000n,
    supportsOptionType: 0,
    nonce: 1001n,
  },
  // 2. WETH Put, 1-72h, 500 units (5.0 WETH), rate: 7,500 raw USDC ($18/day per ETH)
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 1,
    maxHours: 72,
    totalUnits: 500n,
    pricePerUnitPerHour: 7500n,
    supportsOptionType: 1,
    nonce: 1002n,
  },
  // 3. WETH Both, 6-168h, 700 units (7.0 WETH), rate: 10,000 raw USDC ($24/day per ETH)
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 6,
    maxHours: 168,
    totalUnits: 700n,
    pricePerUnitPerHour: 10000n,
    supportsOptionType: 2,
    nonce: 1003n,
  },
  // 4. WETH Both, 12-720h, 1,000 units (10.0 WETH), rate: 14,000 raw USDC ($33.60/day per ETH)
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 12,
    maxHours: 720,
    totalUnits: 1000n,
    pricePerUnitPerHour: 14000n,
    supportsOptionType: 2,
    nonce: 1004n,
  },
  // WBTC Profiles (1 unit = 0.01 WBTC = $600)
  // 5. WBTC Call, 1-72h, 100 units (1.0 WBTC), rate: 100,000 raw USDC ($240/day per WBTC)
  {
    collateral: tokens.WBTC.address,
    oracle: contracts.wbtcOracle,
    minHours: 1,
    maxHours: 72,
    totalUnits: 100n,
    pricePerUnitPerHour: 100000n,
    supportsOptionType: 0,
    nonce: 1005n,
  },
  // 6. WBTC Both, 6-168h, 200 units (2.0 WBTC), rate: 140,000 raw USDC ($336/day per WBTC)
  {
    collateral: tokens.WBTC.address,
    oracle: contracts.wbtcOracle,
    minHours: 6,
    maxHours: 168,
    totalUnits: 200n,
    pricePerUnitPerHour: 140000n,
    supportsOptionType: 2,
    nonce: 1006n,
  },
];

// Router Quotes backed by V4LiquidityVault (validated via ERC-1271 owner signature)
const quoteSpecs = [
  // WETH Quotes
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 1,
    maxHours: 24,
    maxUnits: 300n,
    pricePerUnitPerHour: 5500n,
    supportsOptionType: 0,
    nonce: 2001n,
  },
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 1,
    maxHours: 72,
    maxUnits: 500n,
    pricePerUnitPerHour: 8000n,
    supportsOptionType: 1,
    nonce: 2002n,
  },
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 6,
    maxHours: 168,
    maxUnits: 700n,
    pricePerUnitPerHour: 10500n,
    supportsOptionType: 2,
    nonce: 2003n,
  },
  {
    collateral: tokens.WETH.address,
    oracle: contracts.wethOracle,
    minHours: 12,
    maxHours: 720,
    maxUnits: 1000n,
    pricePerUnitPerHour: 14500n,
    supportsOptionType: 2,
    nonce: 2004n,
  },
  // WBTC Quotes
  {
    collateral: tokens.WBTC.address,
    oracle: contracts.wbtcOracle,
    minHours: 1,
    maxHours: 72,
    maxUnits: 100n,
    pricePerUnitPerHour: 105000n,
    supportsOptionType: 0,
    nonce: 2005n,
  },
  {
    collateral: tokens.WBTC.address,
    oracle: contracts.wbtcOracle,
    minHours: 6,
    maxHours: 168,
    maxUnits: 200n,
    pricePerUnitPerHour: 145000n,
    supportsOptionType: 2,
    nonce: 2006n,
  },
];

async function main() {
  const signedProfiles = [];
  const profileStoreRecords = [];
  let profileId = 1;

  for (const s of profileSpecs) {
    const message = {
      lp: lpAccount.address,
      collateralAsset: s.collateral,
      settlementAsset: tokens.USDC.address,
      minHours: s.minHours,
      maxHours: s.maxHours,
      totalUnits: s.totalUnits,
      pricePerUnitPerHour: s.pricePerUnitPerHour,
      supportsOptionType: s.supportsOptionType,
      unitScalarNum: 1n,
      unitScalarDen: 100n,
      oracle: s.oracle,
      venue: settlementVenue,
      arbiter: contracts.conditionArbiter,
      condition: contracts.takerProfitCondition || contracts.expiryCondition,
      routeId: config.uniswapV4.routeId,
      maxPriceAge: 86400,
      slippageBps: 100,
      ackUnverifiedTerms: false,
      chainIds: authorizedChains,
      timestamp: BigInt(now),
      nonce: s.nonce,
    };

    const signature = await lpAccount.signTypedData({
      domain: liquidityProfileDomain,
      types: liquidityProfileTypes,
      primaryType: "LiquidityProfile",
      message,
    });

    const serializedBlob = JSON.stringify({
      ...message,
      totalUnits: message.totalUnits.toString(),
      pricePerUnitPerHour: message.pricePerUnitPerHour.toString(),
      unitScalarNum: message.unitScalarNum.toString(),
      unitScalarDen: message.unitScalarDen.toString(),
      chainIds: message.chainIds.map((c) => c.toString()),
      timestamp: message.timestamp.toString(),
      nonce: message.nonce.toString(),
      signature,
    });

    const hash = `${lpAccount.address}-${s.nonce}-${now}`;
    profileStoreRecords.push({
      id: profileId++,
      profile_hash: hash,
      lp: lpAccount.address,
      collateral: s.collateral,
      settlement: tokens.USDC.address,
      min_hours: s.minHours,
      max_hours: s.maxHours,
      total_units: s.totalUnits.toString(),
      price_per_unit: s.pricePerUnitPerHour.toString(),
      option_type: s.supportsOptionType,
      signed_blob: serializedBlob,
      created_at: now,
      invalidated: 0,
    });

    signedProfiles.push(JSON.parse(serializedBlob));
  }

  const signedQuotes = [];
  const quoteStoreRecords = [];
  let quoteId = 1;

  for (const s of quoteSpecs) {
    const message = {
      backer: contracts.v4LiquidityVault,
      collateralAsset: s.collateral,
      settlementAsset: tokens.USDC.address,
      minHours: s.minHours,
      maxHours: s.maxHours,
      maxUnits: s.maxUnits,
      pricePerUnitPerHour: s.pricePerUnitPerHour,
      supportsOptionType: s.supportsOptionType,
      unitScalarNum: 1n,
      unitScalarDen: 100n,
      oracle: s.oracle,
      venue: settlementVenue,
      arbiter: contracts.conditionArbiter,
      condition: contracts.takerProfitCondition || contracts.expiryCondition,
      routeId: config.uniswapV4.routeId,
      maxPriceAge: 86400,
      slippageBps: 100,
      nonce: s.nonce,
    };

    const signature = await lpAccount.signTypedData({
      domain: backerQuoteDomain,
      types: backerQuoteTypes,
      primaryType: "BackerQuote",
      message,
    });

    const serializedBlob = JSON.stringify({
      ...message,
      maxUnits: message.maxUnits.toString(),
      pricePerUnitPerHour: message.pricePerUnitPerHour.toString(),
      unitScalarNum: message.unitScalarNum.toString(),
      unitScalarDen: message.unitScalarDen.toString(),
      nonce: message.nonce.toString(),
      signature,
    });

    const hash = `${contracts.v4LiquidityVault}-${s.nonce}`;
    quoteStoreRecords.push({
      id: quoteId++,
      quote_hash: hash,
      backer: contracts.v4LiquidityVault,
      collateral: s.collateral,
      settlement: tokens.USDC.address,
      min_hours: s.minHours,
      max_hours: s.maxHours,
      maxUnits: s.maxUnits.toString(),
      pricePerUnitPerHour: s.pricePerUnitPerHour.toString(),
      supportsOptionType: s.supportsOptionType,
      unitScalarNum: "1",
      unitScalarDen: "100",
      oracle: s.oracle,
      venue: settlementVenue,
      arbiter: contracts.conditionArbiter,
      condition: contracts.takerProfitCondition || contracts.expiryCondition,
      routeId: config.uniswapV4.routeId,
      maxPriceAge: 86400,
      slippageBps: 100,
      nonce: s.nonce.toString(),
      signature,
      total_units: s.maxUnits.toString(),
      price_per_unit: s.pricePerUnitPerHour.toString(),
      option_type: s.supportsOptionType,
      signed_blob: serializedBlob,
      created_at: now,
      invalidated: 0,
    });

    signedQuotes.push(JSON.parse(serializedBlob));
  }

  const storeData = {
    profiles: profileStoreRecords,
    quotes: quoteStoreRecords,
    nextProfileId: profileId,
    nextQuoteId: quoteId,
  };

  const seedPayload = {
    profiles: signedProfiles,
    quotes: signedQuotes,
  };

  // Write to app/data/profiles-store.json
  const storePath = path.join(ROOT, "app", "data", "profiles-store.json");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2), "utf-8");
  console.log("✔ Wrote", profileStoreRecords.length, "profiles &", quoteStoreRecords.length, "quotes to", storePath);

  // Write to app/data/seed-liquidity.json
  const seedDataPath = path.join(ROOT, "app", "data", "seed-liquidity.json");
  fs.writeFileSync(seedDataPath, JSON.stringify(seedPayload, null, 2), "utf-8");
  console.log("✔ Wrote seed payload to", seedDataPath);

  // Write to app/public/seed-liquidity.json
  const publicSeedPath = path.join(ROOT, "app", "public", "seed-liquidity.json");
  fs.mkdirSync(path.dirname(publicSeedPath), { recursive: true });
  fs.writeFileSync(publicSeedPath, JSON.stringify(seedPayload, null, 2), "utf-8");
  console.log("✔ Wrote seed payload to", publicSeedPath);

  console.log("🎉 Profile & quote generation complete!");
}

main().catch((err) => {
  console.error("Error generating profiles:", err);
  process.exit(1);
});
