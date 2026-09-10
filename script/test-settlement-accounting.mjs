#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Comprehensive automated test of on-chain option settlement and accountability
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "app", "package.json"));

const {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  encodeAbiParameters,
  keccak256,
  formatUnits,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const CONFIG_PATH = path.join(ROOT, "local-anvil.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const PROFILES_PATH = path.join(ROOT, "app", "data", "profiles-store.json");
const store = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf-8"));

const PositionManagerAbi = require(path.join(ROOT, "app", "src", "generated", "abis", "PositionManager.ts")).PositionManagerAbi;
const PositionAccountAbi = require(path.join(ROOT, "app", "src", "generated", "abis", "PositionAccount.ts")).PositionAccountAbi;
const MockERC20Abi = require(path.join(ROOT, "app", "src", "generated", "abis", "MockERC20.ts")).MockERC20Abi;

const MockPriceOracleAbi = [
  {
    type: "function",
    name: "setPrice",
    inputs: [
      { name: "price_", type: "uint256" },
      { name: "updatedAt_", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "price",
    inputs: [
      { name: "collateral", type: "address" },
      { name: "settlement", type: "address" },
    ],
    outputs: [
      { name: "price_", type: "uint256" },
      { name: "updatedAt_", type: "uint256" },
    ],
    stateMutability: "view",
  },
];

const MockSettlementVenueAbi = [
  {
    type: "function",
    name: "setRate",
    inputs: [
      { name: "numerator", type: "uint256" },
      { name: "denominator", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

const chain = {
  id: Number(config.chainId),
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
};

const publicClient = createPublicClient({ chain, transport: http() });

const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ELPI1_KEY = "0xb9912f8133b56bb35ebf2baf7a62faa21e0c30f865c4e9abc599aab8bcb7e7fa";
const ELPI2_KEY = "0xfdc6e5b4548767f71e2b7b835529510d49436a578dc5b57ede07a2be0866c0b4";

const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);
const lpAccount = privateKeyToAccount(ELPI1_KEY);
const takerAccount = privateKeyToAccount(ELPI2_KEY);

const deployerWallet = createWalletClient({ account: deployerAccount, chain, transport: http() });
const lpWallet = createWalletClient({ account: lpAccount, chain, transport: http() });
const takerWallet = createWalletClient({ account: takerAccount, chain, transport: http() });

const ACTION_CONTEXT_ABI_TYPE = {
  type: "tuple",
  components: [
    { name: "account", type: "address" },
    { name: "implementation", type: "address" },
    { name: "homeChainId", type: "uint256" },
    { name: "positionManager", type: "address" },
    { name: "positionId", type: "uint256" },
    { name: "accountState", type: "uint256" },
    { name: "signerEpoch", type: "uint256" },
    { name: "actionKind", type: "uint8" },
    { name: "params", type: "bytes" },
    { name: "deadline", type: "uint256" },
    {
      name: "economics",
      type: "tuple",
      components: [
        { name: "lp", type: "address" },
        { name: "collateralAsset", type: "address" },
        { name: "collateralDecimals", type: "uint8" },
        { name: "settlementAsset", type: "address" },
        { name: "settlementDecimals", type: "uint8" },
        { name: "optionType", type: "uint8" },
        { name: "units", type: "uint256" },
        { name: "unitScalarNum", type: "uint256" },
        { name: "unitScalarDen", type: "uint256" },
        { name: "entryPrice", type: "uint256" },
        { name: "expiry", type: "uint64" },
        { name: "feeBps", type: "uint16" },
      ],
    },
    {
      name: "pointers",
      type: "tuple",
      components: [
        { name: "oracle", type: "address" },
        { name: "venue", type: "address" },
        { name: "arbiter", type: "address" },
        { name: "condition", type: "address" },
        { name: "routeId", type: "bytes32" },
        { name: "maxPriceAge", type: "uint32" },
        { name: "slippageBps", type: "uint16" },
      ],
    },
  ],
};

function encodeArbiterApproval(ctx) {
  return encodeAbiParameters([ACTION_CONTEXT_ABI_TYPE, { type: "bytes" }], [ctx, "0x"]);
}

function encodeSettleToTakerParams(p) {
  return encodeAbiParameters(
    [
      { name: "exitPrice", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "minPayoutToTaker", type: "uint256" },
      { name: "swapDeadline", type: "uint256" },
    ],
    [p.exitPrice, p.minAmountOut, p.minPayoutToTaker, p.swapDeadline]
  );
}

const actionTypes = {
  Action: [
    { name: "chainId", type: "uint256" },
    { name: "account", type: "address" },
    { name: "accountState", type: "uint256" },
    { name: "signerEpoch", type: "uint256" },
    { name: "actionKind", type: "uint8" },
    { name: "paramsHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

async function mintOption(optionType, unitsToTake = 10n, durationHours = 24) {
  // Find a matching profile
  const profileRecord = store.profiles.find((p) => {
    const d = JSON.parse(p.signed_blob);
    return d.supportsOptionType === optionType || d.supportsOptionType === 2;
  });
  if (!profileRecord) throw new Error(`No profile found for optionType ${optionType}`);
  const p = JSON.parse(profileRecord.signed_blob);

  // Approve PositionManager for premium
  const premium = unitsToTake * BigInt(durationHours) * BigInt(p.pricePerUnitPerHour);
  const approveHash = await takerWallet.writeContract({
    address: p.settlementAsset,
    abi: MockERC20Abi,
    functionName: "approve",
    args: [config.contracts.positionManager, premium * 100n],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

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
    args: [profileParam, unitsToTake, durationHours, pointersParam, optionType, false],
  });
  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  const logs = parseEventLogs({
    abi: PositionManagerAbi,
    eventName: "PositionMinted",
    logs: mintReceipt.logs,
  });
  if (logs.length === 0) throw new Error("PositionMinted log not found!");

  return {
    positionId: logs[0].args.positionId,
    account: logs[0].args.account,
    economics: logs[0].args.economics,
    pointers: logs[0].args.pointers,
  };
}

async function main() {
  console.log("\n=============================================================");
  console.log("       ELPI COMPREHENSIVE SETTLEMENT & ACCOUNTABILITY        ");
  console.log("=============================================================\n");

  const wethAddress = config.tokens.WETH.address;
  const usdcAddress = config.tokens.USDC.address;
  const feeVaultAddress = config.accounts.feeVault;
  const oracleAddress = config.contracts.wethOracle;
  const venueAddress = config.contracts.mockSettlementVenue;

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 1: CALL OPTION ITM SETTLEMENT
  // ─────────────────────────────────────────────────────────────────────────
  console.log("--- 1. Testing CALL Option ITM Settlement (settleToTaker) ---");
  // Set baseline price: $3,000
  await deployerWallet.writeContract({
    address: oracleAddress,
    abi: MockPriceOracleAbi,
    functionName: "setPrice",
    args: [3000n * 10n ** 18n, 0n],
  });
  await deployerWallet.writeContract({
    address: venueAddress,
    abi: MockSettlementVenueAbi,
    functionName: "setRate",
    args: [3000n * 10n ** 6n, 10n ** 18n],
  });

  console.log("Minting 0.1 WETH Call option at $3,000 strike...");
  const callPos = await mintOption(0, 10n, 24);
  console.log(`✓ CALL Position #${callPos.positionId} minted at account: ${callPos.account}`);

  // Spot surges to $3,500 (+16.67% gain)
  console.log("Steering oracle spot price to $3,500...");
  await deployerWallet.writeContract({
    address: oracleAddress,
    abi: MockPriceOracleAbi,
    functionName: "setPrice",
    args: [3500n * 10n ** 18n, 0n],
  });
  await deployerWallet.writeContract({
    address: venueAddress,
    abi: MockSettlementVenueAbi,
    functionName: "setRate",
    args: [3500n * 10n ** 6n, 10n ** 18n],
  });

  const takerUsdcBeforeCall = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [takerAccount.address],
  });
  const feeVaultUsdcBeforeCall = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [feeVaultAddress],
  });
  const lpWethBeforeCall = await publicClient.readContract({
    address: wethAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [lpAccount.address],
  });

  const chainNowCall = await publicClient.getBlock().then((b) => b.timestamp);
  const [callAccountState, callSignerEpoch] = await Promise.all([
    publicClient.readContract({
      address: callPos.account,
      abi: PositionAccountAbi,
      functionName: "accountState",
    }),
    publicClient.readContract({
      address: config.contracts.positionManager,
      abi: PositionManagerAbi,
      functionName: "signerEpochOf",
      args: [callPos.positionId],
    }),
  ]);

  const callParams = encodeSettleToTakerParams({
    exitPrice: 3500n * 10n ** 18n,
    minAmountOut: 0n,
    minPayoutToTaker: 0n,
    swapDeadline: chainNowCall + 3600n,
  });

  const callCtx = {
    account: callPos.account,
    implementation: config.contracts.positionAccountImplementation,
    homeChainId: BigInt(config.chainId),
    positionManager: config.contracts.positionManager,
    positionId: callPos.positionId,
    accountState: callAccountState,
    signerEpoch: callSignerEpoch,
    actionKind: 0, // SettleToTaker
    params: callParams,
    deadline: chainNowCall + 3600n,
    economics: callPos.economics,
    pointers: callPos.pointers,
  };

  const callTakerSig = await takerWallet.signTypedData({
    domain: {
      name: "OptionCore",
      version: "1",
      chainId: config.chainId,
      verifyingContract: callPos.account,
    },
    types: actionTypes,
    primaryType: "Action",
    message: {
      chainId: BigInt(config.chainId),
      account: callCtx.account,
      accountState: callCtx.accountState,
      signerEpoch: callCtx.signerEpoch,
      actionKind: callCtx.actionKind,
      paramsHash: keccak256(callCtx.params),
      deadline: callCtx.deadline,
    },
  });

  const callArbiterApproval = encodeArbiterApproval(callCtx);

  console.log("Submitting settleToTaker on-chain...");
  const callSettleHash = await takerWallet.writeContract({
    address: callPos.account,
    abi: PositionAccountAbi,
    functionName: "settleToTaker",
    args: [
      callCtx,
      [
        { slot: 1, signature: callTakerSig },
        { slot: 2, signature: callArbiterApproval },
      ],
    ],
  });
  const callSettleReceipt = await publicClient.waitForTransactionReceipt({ hash: callSettleHash });
  console.log("✓ CALL settleToTaker tx mined. Status:", callSettleReceipt.status);

  const takerUsdcAfterCall = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [takerAccount.address],
  });
  const feeVaultUsdcAfterCall = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [feeVaultAddress],
  });
  const lpWethAfterCall = await publicClient.readContract({
    address: wethAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [lpAccount.address],
  });

  const takerProfitUsdc = Number(takerUsdcAfterCall - takerUsdcBeforeCall) / 1e6;
  const protocolFeeUsdc = Number(feeVaultUsdcAfterCall - feeVaultUsdcBeforeCall) / 1e6;
  const lpWethRecovered = Number(lpWethAfterCall - lpWethBeforeCall) / 1e18;

  console.log(`  Expected Taker Payout : $49.50 USDC`);
  console.log(`  Actual Taker Payout   : $${takerProfitUsdc.toFixed(2)} USDC`);
  console.log(`  Expected Fee (1%)     : $0.50 USDC`);
  console.log(`  Actual Fee Collected  : $${protocolFeeUsdc.toFixed(2)} USDC`);
  console.log(`  LP Remainder WETH     : ${lpWethRecovered.toFixed(6)} WETH`);

  if (Math.abs(takerProfitUsdc - 49.5) > 0.01) {
    throw new Error(`CALL Taker profit mismatch: got ${takerProfitUsdc}, expected 49.50`);
  }
  if (Math.abs(protocolFeeUsdc - 0.5) > 0.01) {
    throw new Error(`CALL Fee mismatch: got ${protocolFeeUsdc}, expected 0.50`);
  }
  console.log("🎉 CALL Option Settlement & Accounting Verified 100% Correct!\n");

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 2: PUT OPTION ITM SETTLEMENT
  // ─────────────────────────────────────────────────────────────────────────
  console.log("--- 2. Testing PUT Option ITM Settlement (settleToTaker) ---");
  // Reset oracle and venue to $3,000
  await deployerWallet.writeContract({
    address: oracleAddress,
    abi: MockPriceOracleAbi,
    functionName: "setPrice",
    args: [3000n * 10n ** 18n, 0n],
  });
  await deployerWallet.writeContract({
    address: venueAddress,
    abi: MockSettlementVenueAbi,
    functionName: "setRate",
    args: [3000n * 10n ** 6n, 10n ** 18n],
  });

  console.log("Minting 0.1 WETH Put option at $3,000 strike ($300 locked USDC)...");
  const putPos = await mintOption(1, 10n, 24);
  console.log(`✓ PUT Position #${putPos.positionId} minted at account: ${putPos.account}`);

  // Spot drops to $2,500 (-16.67% drop)
  console.log("Steering oracle spot price to $2,500...");
  await deployerWallet.writeContract({
    address: oracleAddress,
    abi: MockPriceOracleAbi,
    functionName: "setPrice",
    args: [2500n * 10n ** 18n, 0n],
  });
  await deployerWallet.writeContract({
    address: venueAddress,
    abi: MockSettlementVenueAbi,
    functionName: "setRate",
    args: [2500n * 10n ** 6n, 10n ** 18n],
  });

  const takerUsdcBeforePut = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [takerAccount.address],
  });
  const feeVaultUsdcBeforePut = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [feeVaultAddress],
  });
  const lpUsdcBeforePut = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [lpAccount.address],
  });

  const chainNowPut = await publicClient.getBlock().then((b) => b.timestamp);
  const [putAccountState, putSignerEpoch] = await Promise.all([
    publicClient.readContract({
      address: putPos.account,
      abi: PositionAccountAbi,
      functionName: "accountState",
    }),
    publicClient.readContract({
      address: config.contracts.positionManager,
      abi: PositionManagerAbi,
      functionName: "signerEpochOf",
      args: [putPos.positionId],
    }),
  ]);

  const putParams = encodeSettleToTakerParams({
    exitPrice: 2500n * 10n ** 18n,
    minAmountOut: 0n,
    minPayoutToTaker: 0n,
    swapDeadline: chainNowPut + 3600n,
  });

  const putCtx = {
    account: putPos.account,
    implementation: config.contracts.positionAccountImplementation,
    homeChainId: BigInt(config.chainId),
    positionManager: config.contracts.positionManager,
    positionId: putPos.positionId,
    accountState: putAccountState,
    signerEpoch: putSignerEpoch,
    actionKind: 0, // SettleToTaker
    params: putParams,
    deadline: chainNowPut + 3600n,
    economics: putPos.economics,
    pointers: putPos.pointers,
  };

  const putTakerSig = await takerWallet.signTypedData({
    domain: {
      name: "OptionCore",
      version: "1",
      chainId: config.chainId,
      verifyingContract: putPos.account,
    },
    types: actionTypes,
    primaryType: "Action",
    message: {
      chainId: BigInt(config.chainId),
      account: putCtx.account,
      accountState: putCtx.accountState,
      signerEpoch: putCtx.signerEpoch,
      actionKind: putCtx.actionKind,
      paramsHash: keccak256(putCtx.params),
      deadline: putCtx.deadline,
    },
  });

  const putArbiterApproval = encodeArbiterApproval(putCtx);

  console.log("Submitting settleToTaker on PUT position...");
  const putSettleHash = await takerWallet.writeContract({
    address: putPos.account,
    abi: PositionAccountAbi,
    functionName: "settleToTaker",
    args: [
      putCtx,
      [
        { slot: 1, signature: putTakerSig },
        { slot: 2, signature: putArbiterApproval },
      ],
    ],
  });
  const putSettleReceipt = await publicClient.waitForTransactionReceipt({ hash: putSettleHash });
  console.log("✓ PUT settleToTaker tx mined. Status:", putSettleReceipt.status);

  const takerUsdcAfterPut = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [takerAccount.address],
  });
  const feeVaultUsdcAfterPut = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [feeVaultAddress],
  });
  const lpUsdcAfterPut = await publicClient.readContract({
    address: usdcAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [lpAccount.address],
  });

  const takerProfitUsdcPut = Number(takerUsdcAfterPut - takerUsdcBeforePut) / 1e6;
  const protocolFeeUsdcPut = Number(feeVaultUsdcAfterPut - feeVaultUsdcBeforePut) / 1e6;
  const lpUsdcRecovered = Number(lpUsdcAfterPut - lpUsdcBeforePut) / 1e6;

  console.log(`  Expected Taker Payout : $49.50 USDC`);
  console.log(`  Actual Taker Payout   : $${takerProfitUsdcPut.toFixed(2)} USDC`);
  console.log(`  Expected Fee (1%)     : $0.50 USDC`);
  console.log(`  Actual Fee Collected  : $${protocolFeeUsdcPut.toFixed(2)} USDC`);
  console.log(`  Expected LP Remainder : $250.00 USDC`);
  console.log(`  Actual LP Remainder   : $${lpUsdcRecovered.toFixed(2)} USDC`);

  if (Math.abs(takerProfitUsdcPut - 49.5) > 0.01) {
    throw new Error(`PUT Taker profit mismatch: got ${takerProfitUsdcPut}, expected 49.50`);
  }
  if (Math.abs(protocolFeeUsdcPut - 0.5) > 0.01) {
    throw new Error(`PUT Fee mismatch: got ${protocolFeeUsdcPut}, expected 0.50`);
  }
  if (Math.abs(lpUsdcRecovered - 250.0) > 0.01) {
    throw new Error(`PUT LP recovery mismatch: got ${lpUsdcRecovered}, expected 250.00`);
  }
  console.log("🎉 PUT Option Settlement & Accounting Verified 100% Correct!\n");

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 3: EXPIRED OPTION LP RECOVERY (settleToLp)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("--- 3. Testing Expired Option Recovery (settleToLp) ---");
  // Reset oracle to $3,000
  await deployerWallet.writeContract({
    address: oracleAddress,
    abi: MockPriceOracleAbi,
    functionName: "setPrice",
    args: [3000n * 10n ** 18n, 0n],
  });

  console.log("Minting 0.1 WETH Call option for expiry test...");
  const expPos = await mintOption(0, 10n, 24);
  console.log(`✓ Position #${expPos.positionId} minted for expiry test`);

  // Fast forward Anvil timestamp by 25 hours (90,000s)
  console.log("Fast-forwarding Anvil time by 25 hours (+90,000s)...");
  await publicClient.transport.request({
    method: "evm_increaseTime",
    params: [90000],
  });
  await publicClient.transport.request({
    method: "evm_mine",
    params: [],
  });

  const lpWethBeforeExp = await publicClient.readContract({
    address: wethAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [lpAccount.address],
  });

  const chainNowExp = await publicClient.getBlock().then((b) => b.timestamp);
  const [expAccountState, expSignerEpoch] = await Promise.all([
    publicClient.readContract({
      address: expPos.account,
      abi: PositionAccountAbi,
      functionName: "accountState",
    }),
    publicClient.readContract({
      address: config.contracts.positionManager,
      abi: PositionManagerAbi,
      functionName: "signerEpochOf",
      args: [expPos.positionId],
    }),
  ]);

  const expCtx = {
    account: expPos.account,
    implementation: config.contracts.positionAccountImplementation,
    homeChainId: BigInt(config.chainId),
    positionManager: config.contracts.positionManager,
    positionId: expPos.positionId,
    accountState: expAccountState,
    signerEpoch: expSignerEpoch,
    actionKind: 1, // SettleToLp
    params: "0x",
    deadline: chainNowExp + 3600n,
    economics: expPos.economics,
    pointers: expPos.pointers,
  };

  const lpSig = await lpWallet.signTypedData({
    domain: {
      name: "OptionCore",
      version: "1",
      chainId: config.chainId,
      verifyingContract: expPos.account,
    },
    types: actionTypes,
    primaryType: "Action",
    message: {
      chainId: BigInt(config.chainId),
      account: expCtx.account,
      accountState: expCtx.accountState,
      signerEpoch: expCtx.signerEpoch,
      actionKind: expCtx.actionKind,
      paramsHash: keccak256("0x"),
      deadline: expCtx.deadline,
    },
  });

  const expArbiterApproval = encodeArbiterApproval(expCtx);

  console.log("Submitting settleToLp on expired position...");
  const expSettleHash = await lpWallet.writeContract({
    address: expPos.account,
    abi: PositionAccountAbi,
    functionName: "settleToLp",
    args: [
      expCtx,
      [
        { slot: 0, signature: lpSig },
        { slot: 2, signature: expArbiterApproval },
      ],
    ],
  });
  const expSettleReceipt = await publicClient.waitForTransactionReceipt({ hash: expSettleHash });
  console.log("✓ settleToLp tx mined. Status:", expSettleReceipt.status);

  const lpWethAfterExp = await publicClient.readContract({
    address: wethAddress,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [lpAccount.address],
  });

  const recoveredCollateral = Number(lpWethAfterExp - lpWethBeforeExp) / 1e18;
  console.log(`  Expected LP Recovery  : 0.100000 WETH (100%)`);
  console.log(`  Actual LP Recovery    : ${recoveredCollateral.toFixed(6)} WETH`);

  if (Math.abs(recoveredCollateral - 0.1) > 0.0001) {
    throw new Error(`LP recovery mismatch: got ${recoveredCollateral}, expected 0.10`);
  }
  console.log("🎉 Expired Option Settlement & Recovery Verified 100% Correct!\n");

  // Reset baseline oracle and venue rate
  await deployerWallet.writeContract({
    address: oracleAddress,
    abi: MockPriceOracleAbi,
    functionName: "setPrice",
    args: [3000n * 10n ** 18n, 0n],
  });
  await deployerWallet.writeContract({
    address: venueAddress,
    abi: MockSettlementVenueAbi,
    functionName: "setRate",
    args: [3000n * 10n ** 6n, 10n ** 18n],
  });

  console.log("=============================================================");
  console.log("     ALL SETTLEMENT & ACCOUNTABILITY TESTS PASSED (3/3)      ");
  console.log("=============================================================\n");
}

main().catch((err) => {
  console.error("❌ Settlement test failed:", err);
  process.exit(1);
});
