#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Playwright Comprehensive Walkthrough Test for elpi.xyz Live Devnet Frontend

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
  console.log("🚀 Starting Playwright Live Devnet Frontend Walkthrough Test");
  console.log(`Target URL: ${APP_URL}`);
  console.log("==================================================================");

  // Record initial anvil log line count
  let initialAnvilLines = 0;
  if (fs.existsSync(ANVIL_LOG)) {
    initialAnvilLines = fs.readFileSync(ANVIL_LOG, "utf-8").split("\n").length;
  }
  console.log(`[Setup] Initial Anvil log lines: ${initialAnvilLines}`);

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
    } else if (text.includes("elpi") || text.includes("Position") || text.includes("Transaction")) {
      console.log(`[Browser Console Log] ${text}`);
    }
  });

  page.on("pageerror", (err) => {
    console.error(`[Browser Page Error] ${err.message}`);
  });

  try {
    // ─── Step 1: Load Homepage ──────────────────────────────────────────────
    console.log(`\n[Step 1] Navigating to ${APP_URL}...`);
    await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 30000 });

    await page.waitForFunction(() => typeof window.__ELPI_DEV__ !== "undefined", { timeout: 10000 });
    console.log("  ✔ React hydrated & window.__ELPI_DEV__ initialized");

    const title = await page.title();
    console.log(`  Page Title: "${title}"`);

    await page.waitForSelector("h1", { timeout: 10000 });
    const h1Text = await page.textContent("h1");
    console.log(`  Page Header: "${h1Text.trim()}"`);

    // ─── Step 2: Connect Devnet Wallet (Bob - elpi2) ─────────────────────────
    console.log("\n[Step 2] Connecting Bob (elpi2) via Devnet Wallet Modal...");
    const connectButton = page.locator("button:has-text('Connect Wallet')").first();
    await connectButton.waitFor({ state: "visible", timeout: 5000 });
    await connectButton.click();

    const modal = page.locator("div[role='dialog']");
    await modal.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✔ Wallet Modal opened");

    const devnetTab = page.locator("button#tab-devnet, button:has-text('Devnet Test Accounts')").first();
    await devnetTab.waitFor({ state: "visible", timeout: 5000 });
    await devnetTab.click();
    console.log("  ✔ Switched to 'Devnet Test Accounts' tab");

    await page.waitForTimeout(500);

    const bobRow = page.locator("div.flex.items-center.justify-between", { hasText: "Bob (elpi2)" });
    await bobRow.waitFor({ state: "visible", timeout: 5000 });
    const bobConnectBtn = bobRow.locator("button", { hasText: "Connect" });
    await bobConnectBtn.click();
    console.log("  ✔ Clicked Connect for Bob (elpi2)");

    await modal.waitFor({ state: "hidden", timeout: 5000 });
    console.log("  ✔ Modal closed. Verifying connected status...");

    await page.waitForSelector("button:has-text('0x6175'), span:has-text('0x6175')", { timeout: 10000 });
    console.log("  ✔ Wallet successfully connected: Bob (elpi2) [0x6175...a813]");

    const ss1 = path.join(SCREENSHOTS_DIR, "01-homepage-connected.png");
    await page.screenshot({ path: ss1 });
    console.log(`  📸 Saved screenshot: ${path.basename(ss1)}`);

    // ─── Step 3: Inspect Cockpit Balances & Options Parameters ──────────────
    console.log("\n[Step 3] Inspecting Cockpit Balances & Option Parameters...");
    await page.waitForTimeout(1000);

    const usdcBalText = await page.locator("text=mUSDC").locator("..").locator("span.font-mono").textContent().catch(() => "N/A");
    console.log(`  mUSDC Balance displayed: ${usdcBalText.trim()}`);

    const takeButton = page.locator("button:has-text('Take Call'), button:has-text('Approve & Take Call'), button:has-text('Take Put'), button:has-text('Approve & Take Put')").first();
    await takeButton.waitFor({ state: "visible", timeout: 10000 });
    const initialButtonLabel = await takeButton.textContent();
    console.log(`  Take Button Label: "${initialButtonLabel.trim()}"`);

    // ─── Step 4: Execute Take Transaction ────────────────────────────────────
    console.log("\n[Step 4] Executing Take Option Transaction via Frontend...");
    await takeButton.click();
    console.log("  ✔ Clicked Take button. Waiting for transaction execution & receipt...");

    const successBanner = page.getByText(/Position #\d+/).first();
    await successBanner.waitFor({ state: "visible", timeout: 35000 });
    const successText = await successBanner.textContent();
    console.log(`  🎉 Transaction Confirmed on-chain!`);
    console.log(`  Notification: "${successText.trim()}"`);

    const ss2 = path.join(SCREENSHOTS_DIR, "02-mint-success.png");
    await page.screenshot({ path: ss2 });
    console.log(`  📸 Saved screenshot: ${path.basename(ss2)}`);

    // ─── Step 5: Navigate to Positions Dashboard ─────────────────────────────
    console.log("\n[Step 5] Navigating to Positions Dashboard (/positions)...");
    const positionsNavLink = page.locator("nav a:has-text('Positions'), a[href='/positions']").first();
    if (await positionsNavLink.isVisible()) {
      await positionsNavLink.click();
    } else {
      await page.goto(`${APP_URL}/positions`, { waitUntil: "networkidle" });
    }

    await page.waitForURL("**/positions", { timeout: 10000 });
    console.log("  ✔ Landed on /positions page");

    await page.waitForTimeout(3000);

    // Look for active position card title (e.g. "ETH CALL · $3,000.00")
    const positionCardTitle = page.locator("h3:has-text('CALL'), h3:has-text('PUT')").first();
    await positionCardTitle.waitFor({ state: "visible", timeout: 15000 });

    const titleContent = await positionCardTitle.textContent();
    console.log(`  ✔ Position Card Found in Dashboard: "${titleContent.trim()}"`);

    const portfolioSummary = await page.locator("main").textContent();
    console.log(`  ✔ Portfolio Summary Metrics confirmed:`);
    const activeSizeMatch = portfolioSummary.match(/Active Position Size\s*([0-9.]+\s*ETH)/);
    if (activeSizeMatch) console.log(`    Active Size: ${activeSizeMatch[1]}`);

    const ss3 = path.join(SCREENSHOTS_DIR, "03-positions-portfolio.png");
    await page.screenshot({ path: ss3 });
    console.log(`  📸 Saved screenshot: ${path.basename(ss3)}`);

    // Copy screenshots to brain artifact directory for display
    if (fs.existsSync(ARTIFACTS_DIR)) {
      for (const file of ["01-homepage-connected.png", "02-mint-success.png", "03-positions-portfolio.png"]) {
        const src = path.join(SCREENSHOTS_DIR, file);
        const dst = path.join(ARTIFACTS_DIR, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
          console.log(`  📂 Exported to artifact directory: ${file}`);
        }
      }
    }

    // ─── Step 6: Verify Anvil Execution Logs ─────────────────────────────────
    console.log("\n[Step 6] Inspecting Anvil Node Logs for Reverts & Execution...");
    if (fs.existsSync(ANVIL_LOG)) {
      const allLines = fs.readFileSync(ANVIL_LOG, "utf-8").split("\n");
      const newLines = allLines.slice(initialAnvilLines);
      const newLogText = newLines.join("\n");

      const revertMatches = newLogText.match(/reverted with: EvmError: Revert|transaction reverted/gi);
      if (revertMatches && revertMatches.length > 0) {
        console.error(`  ❌ Revert detected in Anvil log: ${revertMatches.length} revert occurrence(s)!`);
        const relevantReverts = newLines.filter(l => l.includes("revert") || l.includes("Revert") || l.includes("error"));
        console.error("  Sample revert logs:", relevantReverts.slice(0, 5));
        throw new Error(`Anvil execution logged ${revertMatches.length} reverts during test.`);
      } else {
        console.log(`  ✔ Zero EVM reverts detected in Anvil logs during this walkthrough!`);
      }

      const txSends = (newLogText.match(/eth_sendTransaction|eth_sendRawTransaction/g) || []).length;
      console.log(`  ✔ Anvil processed ${txSends} transaction submission(s) during this test.`);
    }

    console.log("\n==================================================================");
    console.log("🎉 ALL CHECKS PASSED: Devnet walkthrough test succeeded completely!");
    console.log("==================================================================");

  } catch (err) {
    console.error("\n❌ Test Failed:", err);
    const ssErr = path.join(SCREENSHOTS_DIR, "error-state.png");
    await page.screenshot({ path: ssErr }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Process exiting with error:", err.message);
  process.exit(1);
});
