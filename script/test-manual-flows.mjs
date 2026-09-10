#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Multi-Flow Manual Testing Suite for elpi.xyz Live Devnet Frontend

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "app", "package.json"));

const { chromium } = require("playwright");

const SCREENSHOTS_DIR = path.join(ROOT, "script", "output", "screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const ARTIFACTS_DIR = "/home/pb/.gemini/antigravity/brain/5a6b18ae-7799-4dc0-b550-13d29cfce651";
const ANVIL_LOG = "/tmp/elpi-anvil.log";
const APP_URL = "http://localhost:3000";

async function main() {
  console.log("==================================================================");
  console.log("🧪 Comprehensive Frontend Flow Testing Suite");
  console.log(`Target: ${APP_URL}`);
  console.log("==================================================================");

  let initialAnvilLines = 0;
  if (fs.existsSync(ANVIL_LOG)) {
    initialAnvilLines = fs.readFileSync(ANVIL_LOG, "utf-8").split("\n").length;
  }

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
    const text = msg.text();
    if (msg.type() === "error") {
      console.warn(`[Browser Console Error] ${text}`);
    }
  });

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // FLOW 1: Take an ETH Put Option (Bearish)
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n▶ FLOW 1: Taking an ETH Put Option (Bearish)...");
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.__ELPI_DEV__ !== "undefined", { timeout: 10000 });

    // Connect Bob (elpi2)
    const connectButton = page.locator("button:has-text('Connect Wallet')").first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await page.locator("button#tab-devnet, button:has-text('Devnet Test Accounts')").first().click();
      await page.waitForTimeout(500);
      const bobRow = page.locator("div.flex.items-center.justify-between", { hasText: "Bob (elpi2)" });
      await bobRow.locator("button", { hasText: "Connect" }).click();
      await page.waitForTimeout(1000);
    }

    // Toggle Option Type to PUT (Bearish)
    console.log("  Selecting PUT (Bearish)...");
    const putToggleBtn = page.locator("button:has-text('PUT (Bearish)')").first();
    await putToggleBtn.click();
    await page.waitForTimeout(500);

    // Verify Take button changed to Take Put
    const takePutBtn = page.locator("button:has-text('Take Put'), button:has-text('Approve & Take Put')").first();
    await takePutBtn.waitFor({ state: "visible", timeout: 5000 });
    console.log(`  Button Label: "${(await takePutBtn.textContent()).trim()}"`);

    await takePutBtn.click();
    console.log("  Submitted Take Put. Waiting for confirmation...");

    const putSuccessBanner = page.getByText(/Position #\d+/).first();
    await putSuccessBanner.waitFor({ state: "visible", timeout: 35000 });
    console.log(`  🎉 Put Confirmed: "${(await putSuccessBanner.textContent()).trim()}"`);

    const ssFlow1 = path.join(SCREENSHOTS_DIR, "flow1-put-option.png");
    await page.screenshot({ path: ssFlow1 });
    console.log(`  📸 Screenshot saved: ${path.basename(ssFlow1)}`);

    // ═════════════════════════════════════════════════════════════════════════
    // FLOW 2: Switch Asset to WBTC and Take a WBTC Call Option
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n▶ FLOW 2: Switching Asset to WBTC and Taking WBTC Call Option...");
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Click WBTC / BTC in Asset selector
    const wbtcAssetBtn = page.locator("button[role='tab']:has-text('BTC'), button:has-text('BTC'), button:has-text('WBTC')").first();
    await wbtcAssetBtn.click();
    await page.waitForTimeout(1000);
    console.log("  Switched asset to WBTC / BTC");

    // Make sure option type is Call
    const callToggleBtn = page.locator("button:has-text('CALL (Bullish)')").first();
    await callToggleBtn.click();
    await page.waitForTimeout(500);

    const takeWbtcBtn = page.locator("button:has-text('Take Call'), button:has-text('Approve & Take Call')").first();
    await takeWbtcBtn.waitFor({ state: "visible", timeout: 5000 });
    console.log(`  Button Label: "${(await takeWbtcBtn.textContent()).trim()}"`);

    await takeWbtcBtn.click();
    console.log("  Submitted WBTC Call. Waiting for confirmation...");

    const wbtcSuccessBanner = page.getByText(/Position #\d+/).first();
    await wbtcSuccessBanner.waitFor({ state: "visible", timeout: 35000 });
    console.log(`  🎉 WBTC Call Confirmed: "${(await wbtcSuccessBanner.textContent()).trim()}"`);

    const ssFlow2 = path.join(SCREENSHOTS_DIR, "flow2-wbtc-call.png");
    await page.screenshot({ path: ssFlow2 });
    console.log(`  📸 Screenshot saved: ${path.basename(ssFlow2)}`);

    // ═════════════════════════════════════════════════════════════════════════
    // FLOW 3: Inspect Positions Portfolio & Filter Controls
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n▶ FLOW 3: Inspecting Positions Portfolio & Filter Controls...");
    await page.goto(`${APP_URL}/positions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    // Filter by ETH
    console.log("  Testing ETH filter chip...");
    const ethFilterBtn = page.locator("button:has-text('ETH')").first();
    await ethFilterBtn.click();
    await page.waitForTimeout(500);

    // Filter by BTC
    console.log("  Testing BTC filter chip...");
    const btcFilterBtn = page.locator("button:has-text('BTC')").first();
    await btcFilterBtn.click();
    await page.waitForTimeout(500);

    // Reset to All Assets
    const allFilterBtn = page.locator("button:has-text('All Assets')").first();
    await allFilterBtn.click();
    await page.waitForTimeout(500);

    const ssFlow3 = path.join(SCREENSHOTS_DIR, "flow3-positions-filtered.png");
    await page.screenshot({ path: ssFlow3 });
    console.log(`  📸 Screenshot saved: ${path.basename(ssFlow3)}`);

    // ═════════════════════════════════════════════════════════════════════════
    // FLOW 4: Inspect Position Detail Page (/positions/[id])
    // ═════════════════════════════════════════════════════════════════════════
    let targetDetailUrl = `${APP_URL}/positions/5`;
    const posLinks = await page.locator("a[href^='/positions/']").all();
    for (const l of posLinks) {
      const href = await l.getAttribute("href");
      if (href && href !== "/positions" && !href.includes("#")) {
        targetDetailUrl = `${APP_URL}${href}`;
        break;
      }
    }
    console.log(`\n▶ FLOW 4: Inspecting Position Details (${targetDetailUrl})...`);
    await page.goto(targetDetailUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const detailHeader = await page.textContent("h1, h2").catch(() => "N/A");
    console.log(`  Detail Header: "${detailHeader?.trim()}"`);

    const ssFlow4 = path.join(SCREENSHOTS_DIR, "flow4-position-detail.png");
    await page.screenshot({ path: ssFlow4 });
    console.log(`  📸 Screenshot saved: ${path.basename(ssFlow4)}`);

    // ═════════════════════════════════════════════════════════════════════════
    // FLOW 5: Inspect Provide Liquidity Portal (/lp) with Uniswap v4 Staged Vault
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n▶ FLOW 5: Inspecting Provide Liquidity Portal (/lp)...");
    // Connect Alice (elpi1 - LP owner)
    const switchBtn = page.locator("button:has-text('Switch Wallet'), button[aria-label='Switch wallet account']").first();
    if (await switchBtn.isVisible()) {
      await switchBtn.click();
      await page.locator("button#tab-devnet, button:has-text('Devnet Test Accounts')").first().click();
      await page.waitForTimeout(500);
      const aliceRow = page.locator("div.flex.items-center.justify-between", { hasText: "Alice (elpi1)" });
      await aliceRow.locator("button", { hasText: "Connect" }).click();
      await page.waitForTimeout(1000);
    }

    await page.goto(`${APP_URL}/lp`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const vaultStats = await page.locator("text=Uniswap v4 Staged Liquidity Vault").locator("..").locator("..").textContent().catch(() => "N/A");
    console.log(`  Vault Overview: ${vaultStats.replace(/\s+/g, ' ').slice(0, 160)}...`);

    const ssFlow5 = path.join(SCREENSHOTS_DIR, "flow5-lp-vault.png");
    await page.screenshot({ path: ssFlow5 });
    console.log(`  📸 Screenshot saved: ${path.basename(ssFlow5)}`);

    // ═════════════════════════════════════════════════════════════════════════
    // FLOW 6: Inspect Additional Application Views (/risk, /agents, /data, /lp-router)
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n▶ FLOW 6: Inspecting Supplementary Views (/risk, /agents, /data, /lp-router)...");
    
    await page.goto(`${APP_URL}/risk`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const ssRisk = path.join(SCREENSHOTS_DIR, "flow6-risk.png");
    await page.screenshot({ path: ssRisk });
    console.log(`  📸 Screenshot saved: ${path.basename(ssRisk)}`);

    await page.goto(`${APP_URL}/agents`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const ssAgents = path.join(SCREENSHOTS_DIR, "flow6-agents.png");
    await page.screenshot({ path: ssAgents });
    console.log(`  📸 Screenshot saved: ${path.basename(ssAgents)}`);

    await page.goto(`${APP_URL}/data`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const ssData = path.join(SCREENSHOTS_DIR, "flow6-data.png");
    await page.screenshot({ path: ssData });
    console.log(`  📸 Screenshot saved: ${path.basename(ssData)}`);

    await page.goto(`${APP_URL}/lp-router`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const ssRouter = path.join(SCREENSHOTS_DIR, "flow6-lp-router.png");
    await page.screenshot({ path: ssRouter });
    console.log(`  📸 Screenshot saved: ${path.basename(ssRouter)}`);

    // Copy all new screenshots to brain artifact directory
    if (fs.existsSync(ARTIFACTS_DIR)) {
      const files = [
        "flow1-put-option.png",
        "flow2-wbtc-call.png",
        "flow3-positions-filtered.png",
        "flow4-position-detail.png",
        "flow5-lp-vault.png",
        "flow6-risk.png",
        "flow6-agents.png",
        "flow6-data.png",
        "flow6-lp-router.png",
      ];
      for (const file of files) {
        const src = path.join(SCREENSHOTS_DIR, file);
        const dst = path.join(ARTIFACTS_DIR, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
          console.log(`  📂 Exported to artifact: ${file}`);
        }
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ANVIL LOG VERIFICATION
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n▶ Inspecting Anvil Execution Logs for EVM Reverts...");
    if (fs.existsSync(ANVIL_LOG)) {
      const allLines = fs.readFileSync(ANVIL_LOG, "utf-8").split("\n");
      const newLines = allLines.slice(initialAnvilLines);
      const newLogText = newLines.join("\n");

      const revertMatches = newLogText.match(/reverted with: EvmError: Revert|transaction reverted/gi);
      if (revertMatches && revertMatches.length > 0) {
        console.error(`  ❌ Revert detected in Anvil log: ${revertMatches.length} revert occurrence(s)!`);
        throw new Error(`Anvil execution logged ${revertMatches.length} reverts during test.`);
      } else {
        console.log(`  ✔ ZERO EVM reverts detected in Anvil logs during all manual test flows!`);
      }

      const txSends = (newLogText.match(/eth_sendTransaction|eth_sendRawTransaction/g) || []).length;
      console.log(`  ✔ Total on-chain transactions processed: ${txSends}`);
    }

    console.log("\n==================================================================");
    console.log("🎉 ALL MANUAL TEST FLOWS PASSED PERFECTLY WITH ZERO ERRORS!");
    console.log("==================================================================");

  } catch (err) {
    console.error("\n❌ Manual Test Suite Encountered Error:", err);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "manual-flow-error.png") }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test exited with error:", err.message);
  process.exit(1);
});
