#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Automated browser test for UI settlement flows of CALL and PUT options

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "app", "package.json"));

const { chromium } = require("playwright");
const { createWalletClient, createPublicClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const SCREENSHOTS_DIR = path.join(ROOT, "script", "output", "screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const ARTIFACTS_DIR = "/home/pb/.gemini/antigravity/brain/5a6b18ae-7799-4dc0-b550-13d29cfce651";
const APP_URL = "http://localhost:3000";

const CONFIG_PATH = path.join(ROOT, "local-anvil.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const chain = {
  id: Number(config.chainId),
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
};

const deployerAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const deployerWallet = createWalletClient({ account: deployerAccount, chain, transport: http() });

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

async function setPrice(priceUsd) {
  const p18 = BigInt(Math.round(priceUsd)) * 10n ** 18n;
  const p6 = BigInt(Math.round(priceUsd)) * 10n ** 6n;
  await deployerWallet.writeContract({
    address: config.contracts.wethOracle,
    abi: MockPriceOracleAbi,
    functionName: "setPrice",
    args: [p18, 0n],
  });
  await deployerWallet.writeContract({
    address: config.contracts.mockSettlementVenue,
    abi: MockSettlementVenueAbi,
    functionName: "setRate",
    args: [p6, 10n ** 18n],
  });
  console.log(`  ⚖ Oracle and Venue steer -> $${priceUsd}`);
}

async function main() {
  console.log("==================================================================");
  console.log("🧪 Live Frontend UI Settlement Testing (Playwright)");
  console.log("==================================================================");

  // Set initial price to baseline 3000
  await setPrice(3000);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.warn(`  [Browser Error] ${msg.text()}`);
    }
  });

  try {
    // -------------------------------------------------------------
    // 1. Connect Bob (Taker) and Mint a CALL Option
    // -------------------------------------------------------------
    console.log("\n▶ Step 1: Navigating to App and Connecting Bob (elpi2)...");
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.__ELPI_DEV__ !== "undefined", { timeout: 10000 });

    const connectBtn = page.locator("button:has-text('Connect Wallet')").first();
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
      await page.locator("button#tab-devnet, button:has-text('Devnet Test Accounts')").first().click();
      await page.waitForTimeout(500);
      const bobRow = page.locator("div.flex.items-center.justify-between", { hasText: "Bob (elpi2)" });
      await bobRow.locator("button", { hasText: "Connect" }).click();
      await page.waitForTimeout(1000);
    }

    console.log("  Ensuring ETH CALL option selected...");
    const callBtn = page.locator("button:has-text('CALL (Bullish)')").first();
    await callBtn.click();
    await page.waitForTimeout(500);

    const takeCallBtn = page.locator("button:has-text('Take Call'), button:has-text('Approve & Take Call')").first();
    await takeCallBtn.waitFor({ state: "visible", timeout: 5000 });
    await takeCallBtn.click();
    console.log("  Submitted Take Call transaction...");

    const callSuccess = page.getByText(/Position #\d+/).first();
    await callSuccess.waitFor({ state: "visible", timeout: 35000 });
    const callText = await callSuccess.textContent();
    console.log(`  ✓ Minted: ${callText.trim()}`);

    // Extract position ID
    const callPosMatch = callText.match(/Position #(\d+)/);
    const callPosId = callPosMatch ? callPosMatch[1] : null;

    // -------------------------------------------------------------
    // 2. Steer Price UP to $3,500 (+16.7% ITM)
    // -------------------------------------------------------------
    console.log("\n▶ Step 2: Steer spot price UP to $3,500 (CALL ITM)...");
    await setPrice(3500);
    await page.waitForTimeout(1000);

    // -------------------------------------------------------------
    // 3. Navigate to Portfolio and Verify In The Money
    // -------------------------------------------------------------
    console.log("\n▶ Step 3: View /positions Portfolio...");
    await page.goto(`${APP_URL}/positions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const ssPortfolio = path.join(SCREENSHOTS_DIR, "settle-01-portfolio-call-itm.png");
    await page.screenshot({ path: ssPortfolio });
    console.log(`  📸 Saved screenshot: ${path.basename(ssPortfolio)}`);

    // Verify "In the Money" badge exists
    const itmBadge = page.locator("span:has-text('In the Money')").first();
    await itmBadge.waitFor({ state: "visible", timeout: 8000 });
    console.log("  ✓ In the Money badge visible on position!");

    // -------------------------------------------------------------
    // 4. Exercise & Close CALL Position via UI
    // -------------------------------------------------------------
    console.log("\n▶ Step 4: Clicking 'Close Position' to settle CALL on-chain...");
    const closeBtn = page.locator("button:has-text('Close Position')").first();
    await closeBtn.waitFor({ state: "visible", timeout: 8000 });
    await closeBtn.click();
    console.log("  Close Position clicked. Signing and executing...");

    // Wait for settlement confirmation banner
    const settledBanner = page.locator("text=Position successfully closed and profit settled").first();
    await settledBanner.waitFor({ state: "visible", timeout: 25000 });
    console.log("  ✓ CALL Position Settlement Confirmed in UI!");

    await page.waitForTimeout(2000);
    const ssCallSettled = path.join(SCREENSHOTS_DIR, "settle-02-call-settled.png");
    await page.screenshot({ path: ssCallSettled });
    console.log(`  📸 Saved screenshot: ${path.basename(ssCallSettled)}`);

    // -------------------------------------------------------------
    // 5. Mint a PUT Option and Settle ITM
    // -------------------------------------------------------------
    console.log("\n▶ Step 5: Reset price to $3,000 and Mint a PUT Option...");
    await setPrice(3000);

    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const putToggle = page.locator("button:has-text('PUT (Bearish)')").first();
    await putToggle.click();
    await page.waitForTimeout(500);

    const takePutBtn = page.locator("button:has-text('Take Put'), button:has-text('Approve & Take Put')").first();
    await takePutBtn.waitFor({ state: "visible", timeout: 5000 });
    await takePutBtn.click();
    console.log("  Submitted Take Put transaction...");

    const putSuccess = page.getByText(/Position #\d+/).first();
    await putSuccess.waitFor({ state: "visible", timeout: 35000 });
    const putText = await putSuccess.textContent();
    console.log(`  ✓ Minted: ${putText.trim()}`);

    // -------------------------------------------------------------
    // 6. Steer Price DOWN to $2,500 (-16.7% ITM)
    // -------------------------------------------------------------
    console.log("\n▶ Step 6: Steer spot price DOWN to $2,500 (PUT ITM)...");
    await setPrice(2500);
    await page.waitForTimeout(1000);

    // -------------------------------------------------------------
    // 7. Navigate to Portfolio and Settle PUT Position via UI
    // -------------------------------------------------------------
    console.log("\n▶ Step 7: View Portfolio and Settle PUT...");
    await page.goto(`${APP_URL}/positions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const ssPutItm = path.join(SCREENSHOTS_DIR, "settle-03-portfolio-put-itm.png");
    await page.screenshot({ path: ssPutItm });
    console.log(`  📸 Saved screenshot: ${path.basename(ssPutItm)}`);

    // Click Close Position on the active PUT
    const closePutBtn = page.locator("button:has-text('Close Position')").first();
    await closePutBtn.waitFor({ state: "visible", timeout: 8000 });
    await closePutBtn.click();
    console.log("  Close Position clicked for PUT...");

    const putSettledBanner = page.locator("text=Position successfully closed and profit settled").first();
    await putSettledBanner.waitFor({ state: "visible", timeout: 25000 });
    console.log("  ✓ PUT Position Settlement Confirmed in UI!");

    await page.waitForTimeout(2000);
    const ssPutSettled = path.join(SCREENSHOTS_DIR, "settle-04-put-settled.png");
    await page.screenshot({ path: ssPutSettled });
    console.log(`  📸 Saved screenshot: ${path.basename(ssPutSettled)}`);

    // Reset oracle price back to baseline $3,000
    await setPrice(3000);

    // Copy screenshots to brain artifact directory
    const exportFiles = [
      "settle-01-portfolio-call-itm.png",
      "settle-02-call-settled.png",
      "settle-03-portfolio-put-itm.png",
      "settle-04-put-settled.png",
    ];
    for (const f of exportFiles) {
      const src = path.join(SCREENSHOTS_DIR, f);
      const dst = path.join(ARTIFACTS_DIR, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        console.log(`  📂 Exported to artifact: ${f}`);
      }
    }

    console.log("\n==================================================================");
    console.log("🎉 ALL UI SETTLEMENT FLOWS (CALL & PUT) SUCCEEDED PERFECTLY!");
    console.log("==================================================================");

  } catch (err) {
    console.error("\n❌ UI Settlement Flow Failed:", err);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "settle-error.png") }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test process exited with error:", err.message);
  process.exit(1);
});
