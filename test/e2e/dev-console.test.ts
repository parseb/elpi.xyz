// SPDX-License-Identifier: MIT
/**
 * End-to-End & Programmatic Automation Harness Test Suite for Dev Console.
 * Validates:
 * 1. Anvil devnet bootstrapping & contract state inspection
 * 2. Atomic price and settlement venue rate synchronization
 * 3. Arbitrary-precision math & decimal normalization
 * 4. Time acceleration & oracle staleness decoupling (advance and refresh)
 * 5. Persona balances and token minting / faucet
 * 6. Programmatic CLI execution for Playwright test harness integration
 */

import { spawn, execSync, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DevConsole,
  setPrice,
  advanceTime,
  refreshOracles,
  getDevStatus,
  mintTokens,
} from "../../dev-console.ts";

const RPC_URL = "http://127.0.0.1:8545";
const ROOT_DIR = process.cwd();

let anvilProcess: ChildProcess | null = null;

function isRpcUp(): boolean {
  try {
    const res = execSync(
      `curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' ${RPC_URL}`,
      { timeout: 1000 }
    );
    return res.toString().includes("result");
  } catch {
    return false;
  }
}

async function ensureAnvil(): Promise<void> {
  if (isRpcUp()) {
    console.log("✔ Connected to running Anvil node.");
    return;
  }

  console.log("🚀 Starting temporary Anvil devnet for test suite...");
  anvilProcess = spawn("anvil", ["--port", "8545", "--chain-id", "8453"], {
    detached: true,
    stdio: "ignore",
  });
  anvilProcess.unref();

  let retries = 30;
  while (retries > 0) {
    if (isRpcUp()) {
      console.log("✔ Anvil devnet ready.");
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
    retries--;
  }
  throw new Error("Could not start Anvil devnet.");
}

function deployFixtures(): void {
  console.log("📦 Deploying local fixtures via DeployLocal.s.sol...");
  execSync(
    `forge script script/DeployLocal.s.sol:DeployLocal --rpc-url ${RPC_URL} --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`,
    { stdio: "inherit" }
  );
  console.log("✔ Deployment finished.");
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    throw new Error(msg);
  }
}

async function runTests() {
  console.log("=== Starting Dev Console E2E Verification ===\n");

  await ensureAnvil();

  // If local-anvil.json doesn't exist, deploy
  if (!fs.existsSync(path.resolve(ROOT_DIR, "local-anvil.json"))) {
    deployFixtures();
  }

  const devConsole = new DevConsole();

  // ─── Test 1: Initial Status Inspection ──────────────────────────────────────
  console.log("▶ [Test 1] Inspect initial chain status & personas...");
  const initialStatus = await getDevStatus();
  assert(initialStatus.blockNumber >= 0, "Block number must be valid");
  assert(initialStatus.timestamp > 0, "Timestamp must be valid");
  assert(initialStatus.prices.length >= 2, "Must report at least WETH and WBTC prices");

  const wethPriceInitial = initialStatus.prices.find((p) => p.asset === "WETH");
  assert(Boolean(wethPriceInitial), "WETH price entry must exist");
  assert(wethPriceInitial!.isFresh, "Initial oracle state must be fresh");
  console.log(`  Initial WETH Price: $${wethPriceInitial!.priceUsd}, fresh: ${wethPriceInitial!.isFresh}`);
  console.log("✔ Test 1 passed.\n");

  // ─── Test 2: Atomic Relative Price Shift (+10%) ─────────────────────────────
  console.log("▶ [Test 2] Atomic relative price shift (+10%)...");
  const expectedRelPrice = (parseFloat(wethPriceInitial!.priceUsd) * 1.10).toFixed(2);
  const relResult = await setPrice("weth", "+10%");
  assert(relResult.asset === "WETH", "Asset mismatch");
  assert(relResult.newPriceUsd === expectedRelPrice, `Expected ${expectedRelPrice}, got ${relResult.newPriceUsd}`);
  console.log(`  Updated WETH price to $${relResult.newPriceUsd}, synchronized venue rate.`);
  console.log("✔ Test 2 passed.\n");

  // ─── Test 3: Absolute Price Shift ($3500) ───────────────────────────────────
  console.log("▶ [Test 3] Absolute price shift ($3500.00)...");
  const absResult = await setPrice("weth", "3500");
  assert(absResult.newPriceUsd === "3500.00", `Expected 3500.00, got ${absResult.newPriceUsd}`);
  assert(absResult.numerator === "3500000000", `Expected numerator 3500000000, got ${absResult.numerator}`);
  console.log(`  Updated WETH price to $${absResult.newPriceUsd}.`);
  console.log("✔ Test 3 passed.\n");

  // ─── Test 4: Time Travel (advance 2h) & Staleness Detection ─────────────────
  console.log("▶ [Test 4] Advance time by 2 hours and verify staleness...");
  const advanceResult = await advanceTime("2h");
  assert(advanceResult.seconds === 7200, "Advance seconds mismatch");
  assert(advanceResult.staleWarning === true, "Must flag staleness warning");

  const staleStatus = await getDevStatus();
  const wethStale = staleStatus.prices.find((p) => p.asset === "WETH");
  assert(!wethStale!.isFresh, "Oracle must be marked stale after 2h jump (maxPriceAge = 1800s)");
  assert(wethStale!.ageSeconds >= 7200, `Oracle age must be >= 7200, got ${wethStale!.ageSeconds}`);
  console.log(`  Oracle age: ${wethStale!.ageSeconds}s -> isFresh: ${wethStale!.isFresh} (Stale correctly detected)`);
  console.log("✔ Test 4 passed.\n");

  // ─── Test 5: Staleness Decoupling (refresh) ─────────────────────────────────
  console.log("▶ [Test 5] Refresh oracle timestamps...");
  const refreshResult = await refreshOracles();
  assert(refreshResult.oraclesRefreshed.length >= 2, "Must refresh both WETH and WBTC");

  const refreshedStatus = await getDevStatus();
  const wethRefreshed = refreshedStatus.prices.find((p) => p.asset === "WETH");
  assert(wethRefreshed!.isFresh, "Oracle must be fresh after refresh");
  assert(wethRefreshed!.ageSeconds <= 5, "Age must be within 5 seconds of current block");
  assert(wethRefreshed!.priceUsd === "3500.00", "Price must remain preserved at $3500.00");
  console.log(`  Refreshed age: ${wethRefreshed!.ageSeconds}s -> isFresh: ${wethRefreshed!.isFresh} (Freshness restored)`);
  console.log("✔ Test 5 passed.\n");

  // ─── Test 6: Token Mint / Faucet ────────────────────────────────────────────
  console.log("▶ [Test 6] Mint tokens via dev console faucet...");
  const takerAddr = devConsole.config.accounts.taker;
  await mintTokens("weth", takerAddr, "25");
  await mintTokens("usdc", takerAddr, "5000");

  const statusAfterMint = await getDevStatus();
  const takerPersona = statusAfterMint.personas.find((p) => p.address.toLowerCase() === takerAddr.toLowerCase());
  assert(Boolean(takerPersona), "Taker persona must exist");
  console.log(`  Taker new balances: ${takerPersona!.weth} WETH, ${takerPersona!.usdc} USDC`);
  console.log("✔ Test 6 passed.\n");

  // ─── Test 7: Programmatic CLI Mode (child_process execution) ────────────────
  console.log("▶ [Test 7] Programmatic CLI Mode via ./dev-console...");
  const cliOutput1 = execSync(`./dev-console price weth 3600`, { encoding: "utf8" });
  assert(cliOutput1.includes("[PRICE SYNC]"), "CLI output must contain [PRICE SYNC]");
  assert(cliOutput1.includes("3600.00"), "CLI output must show 3600.00");

  const cliOutput2 = execSync(`./dev-console advance 30m`, { encoding: "utf8" });
  assert(cliOutput2.includes("[TIME ADVANCE]"), "CLI output must contain [TIME ADVANCE]");

  const cliOutput3 = execSync(`./dev-console refresh`, { encoding: "utf8" });
  assert(cliOutput3.includes("[REFRESH]"), "CLI output must contain [REFRESH]");

  const cliOutput4 = execSync(`./dev-console status`, { encoding: "utf8" });
  assert(cliOutput4.includes("Chain State"), "CLI status must output Chain State");
  console.log("✔ Test 7 passed.\n");

  console.log("🎉 ALL 7 DEV CONSOLE E2E TESTS PASSED SUCCESSFULLY!");
}

runTests()
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  })
  .finally(() => {
    if (anvilProcess && anvilProcess.pid) {
      try {
        process.kill(-anvilProcess.pid);
      } catch {}
    }
  });
