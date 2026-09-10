#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Automated browser test for LP Staged Vault Deposit & Withdraw in the UI

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
const APP_URL = "http://localhost:3000";

async function main() {
  console.log("==================================================================");
  console.log("🧪 Live LP Vault Staging Deposit & Withdraw Flow (Playwright)");
  console.log("==================================================================");

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
    console.log("\n▶ Step 1: Navigating to /lp and connecting Alice (elpi1 - LP Owner)...");
    await page.goto(`${APP_URL}/lp`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.__ELPI_DEV__ !== "undefined", { timeout: 10000 });

    const connectBtn = page.locator("button:has-text('Connect Wallet')").first();
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
      await page.locator("button#tab-devnet, button:has-text('Devnet Test Accounts')").first().click();
      await page.waitForTimeout(500);
      const aliceRow = page.locator("div.flex.items-center.justify-between", { hasText: "Alice (elpi1)" });
      await aliceRow.locator("button", { hasText: "Connect" }).click();
      await page.waitForTimeout(1000);
    } else {
      // Check if another account is connected, switch to Alice
      const switchBtn = page.locator("button:has-text('Switch Wallet'), button[aria-label='Switch wallet account']").first();
      if (await switchBtn.isVisible()) {
        await switchBtn.click();
        await page.locator("button#tab-devnet, button:has-text('Devnet Test Accounts')").first().click();
        await page.waitForTimeout(500);
        const aliceRow = page.locator("div.flex.items-center.justify-between", { hasText: "Alice (elpi1)" });
        await aliceRow.locator("button", { hasText: "Connect" }).click();
        await page.waitForTimeout(1000);
      }
    }

    console.log("  Connected as Alice (elpi1)");
    await page.waitForTimeout(1500);

    // -------------------------------------------------------------
    // Deposit 1.0 WETH into Uniswap v4 Vault
    // -------------------------------------------------------------
    console.log("\n▶ Step 2: Depositing 1.0 WETH into Uniswap v4 Staged Vault...");
    const amountInput = page.locator("input[placeholder*='0.0']").first();
    await amountInput.waitFor({ state: "visible", timeout: 5000 });
    await amountInput.fill("1.0");
    await page.waitForTimeout(500);

    const depositBtn = page.locator("button:has-text('Deposit & Stage In Uniswap v4'), button:has-text('Approve WETH')").first();
    await depositBtn.waitFor({ state: "visible", timeout: 5000 });
    const btnLabel = await depositBtn.textContent();
    console.log(`  Clicking button: "${btnLabel.trim()}"`);
    await depositBtn.click();

    // If approval was needed, wait and click deposit
    if (btnLabel.includes("Approve")) {
      await page.waitForTimeout(3000);
      const postApproveBtn = page.locator("button:has-text('Deposit & Stage In Uniswap v4')").first();
      await postApproveBtn.waitFor({ state: "visible", timeout: 10000 });
      await postApproveBtn.click();
      console.log("  Approved! Now clicking Deposit...");
    }

    // Wait for success confirmation
    const successMsg = page.locator("text=Successfully staged").first();
    await successMsg.waitFor({ state: "visible", timeout: 25000 });
    console.log(`  ✓ Confirmation: "${(await successMsg.textContent()).trim()}"`);

    const ssDeposit = path.join(SCREENSHOTS_DIR, "lp-vault-deposit-success.png");
    await page.screenshot({ path: ssDeposit });
    console.log(`  📸 Saved screenshot: ${path.basename(ssDeposit)}`);

    // -------------------------------------------------------------
    // Withdraw 0.5 WETH from Uniswap v4 Vault
    // -------------------------------------------------------------
    console.log("\n▶ Step 3: Withdrawing 0.5 WETH from Uniswap v4 Staged Vault...");
    await amountInput.fill("0.5");
    await page.waitForTimeout(500);

    const withdrawBtn = page.locator("button:has-text('Withdraw')").first();
    await withdrawBtn.waitFor({ state: "visible", timeout: 5000 });
    await withdrawBtn.click();

    const withdrawSuccess = page.locator("text=Successfully withdrew").first();
    await withdrawSuccess.waitFor({ state: "visible", timeout: 25000 });
    console.log(`  ✓ Confirmation: "${(await withdrawSuccess.textContent()).trim()}"`);

    const ssWithdraw = path.join(SCREENSHOTS_DIR, "lp-vault-withdraw-success.png");
    await page.screenshot({ path: ssWithdraw });
    console.log(`  📸 Saved screenshot: ${path.basename(ssWithdraw)}`);

    // Copy screenshots to brain artifact directory
    const exportFiles = [
      "lp-vault-deposit-success.png",
      "lp-vault-withdraw-success.png",
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
    console.log("🎉 LP VAULT STAGING DEPOSIT & WITHDRAW TEST PASSED COMPLETELY!");
    console.log("==================================================================");

  } catch (err) {
    console.error("\n❌ LP Vault Flow Failed:", err);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "lp-vault-error.png") }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test exited with error:", err.message);
  process.exit(1);
});
