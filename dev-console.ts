#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * elpi (elpi.xyz) Dev Console & Automation Harness
 * Interactive REPL and programmatic E2E testing tool for local devnets (Anvil/Hardhat).
 *
 * Capabilities:
 * - Atomic price and settlement venue rate synchronization
 * - Time travel (advance) & staleness decoupling (refresh)
 * - Persona and balance inspection (status)
 * - Token minting / faucet
 * - Dual-mode: interactive CLI REPL or programmatic command execution
 */

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

// ─── Types & Interfaces ────────────────────────────────────────────────────────

export interface TokenConfig {
  address: string;
  decimals: number;
  symbol: string;
}

export interface DeploymentConfig {
  chainId: number;
  rpcUrl: string;
  contracts: {
    poolManager: string;
    venueAdapter: string;
    optionSettlementHook: string;
    v4LiquidityVault: string;
    mockSettlementVenue: string;
    wethOracle: string;
    wbtcOracle: string;
  };
  tokens: {
    WETH: TokenConfig;
    WBTC: TokenConfig;
    USDC: TokenConfig;
  };
  uniswapV4: {
    routeId: string;
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  accounts: {
    deployer: string;
    lp: string;
    taker: string;
    taker2?: string;
    maker2?: string;
    feeVault: string;
    anvilLp?: string;
    anvilTaker?: string;
    elpi1?: string;
    elpi2?: string;
    elpi3?: string;
    elpi4?: string;
    elpi5?: string;
  };
}

export interface PriceResult {
  asset: string;
  oldPriceUsd: string;
  newPriceUsd: string;
  newPrice1e18: string;
  numerator: string;
  denominator: string;
  oracleTxHash?: string;
  venueTxHash?: string;
  timestamp: number;
}

export interface AdvanceResult {
  seconds: number;
  oldTimestamp: number;
  newTimestamp: number;
  isoDate: string;
  staleWarning: boolean;
}

export interface RefreshResult {
  timestamp: number;
  isoDate: string;
  oraclesRefreshed: Array<{ asset: string; priceUsd: string; address: string }>;
}

export interface BalanceEntry {
  name: string;
  address: string;
  eth: string;
  weth: string;
  wbtc: string;
  usdc: string;
}

export interface StatusResult {
  blockNumber: number;
  timestamp: number;
  isoDate: string;
  prices: Array<{
    asset: string;
    priceUsd: string;
    updatedAt: number;
    ageSeconds: number;
    isFresh: boolean;
    oracleAddress: string;
  }>;
  venue: {
    address: string;
    rateNumerator: string;
    rateDenominator: string;
    effectiveWethRate: string;
    usdcReserve: string;
    wethReserve: string;
    wbtcReserve: string;
  };
  v4Vault?: {
    address: string;
    owner: string;
    lpRouter: string;
    tickLower: number;
    tickUpper: number;
    liquidWeth: string;
    stagedPoolManagerWeth: string;
    pendingAssetWeth: string;
  };
  uniswapV4?: {
    routeId: string;
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  personas: BalanceEntry[];
}

// ─── Default Configuration & Fallbacks ─────────────────────────────────────────

const DEFAULT_RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const MAX_PRICE_AGE_SECONDS = 1800; // 30 minutes

export class DevConsole {
  public config: DeploymentConfig;
  public rpcUrl: string;
  public deployerKey: string;

  constructor(customConfig?: Partial<DeploymentConfig>, rpcUrl?: string) {
    this.rpcUrl = rpcUrl || process.env.RPC_URL || DEFAULT_RPC_URL;
    this.deployerKey = process.env.DEPLOYER_KEY || DEPLOYER_PRIVATE_KEY;
    this.config = this.loadConfig(customConfig);
  }

  private loadDotEnv(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const idx = trimmed.indexOf("=");
            if (idx > 0) {
              const key = trimmed.slice(0, idx).trim();
              const val = trimmed.slice(idx + 1).trim();
              if (!process.env[key]) {
                process.env[key] = val;
              }
            }
          }
        }
      } catch {}
    }
  }

  private loadConfig(customConfig?: Partial<DeploymentConfig>): DeploymentConfig {
    this.loadDotEnv(path.resolve(process.cwd(), ".local.env"));

    const configPath = path.resolve(process.cwd(), "local-anvil.json");
    let loaded: Partial<DeploymentConfig> = {};

    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        loaded = JSON.parse(raw);
      } catch (err) {
        console.warn(`[WARN] Failed to parse local-anvil.json: ${(err as Error).message}`);
      }
    }

    return {
      chainId: customConfig?.chainId || loaded.chainId || 8453,
      rpcUrl: customConfig?.rpcUrl || loaded.rpcUrl || this.rpcUrl,
      contracts: {
        poolManager:
          customConfig?.contracts?.poolManager ||
          loaded.contracts?.poolManager ||
          "0x0000000000000000000000000000000000000000",
        venueAdapter:
          customConfig?.contracts?.venueAdapter ||
          loaded.contracts?.venueAdapter ||
          "0x0000000000000000000000000000000000000000",
        optionSettlementHook:
          customConfig?.contracts?.optionSettlementHook ||
          loaded.contracts?.optionSettlementHook ||
          "0x00000000000000000000000000000000000000c8",
        v4LiquidityVault:
          customConfig?.contracts?.v4LiquidityVault ||
          loaded.contracts?.v4LiquidityVault ||
          "0x0000000000000000000000000000000000000000",
        mockSettlementVenue:
          customConfig?.contracts?.mockSettlementVenue ||
          loaded.contracts?.mockSettlementVenue ||
          "0x0000000000000000000000000000000000000000",
        wethOracle:
          customConfig?.contracts?.wethOracle ||
          loaded.contracts?.wethOracle ||
          "0x0000000000000000000000000000000000000000",
        wbtcOracle:
          customConfig?.contracts?.wbtcOracle ||
          loaded.contracts?.wbtcOracle ||
          "0x0000000000000000000000000000000000000000",
      },
      tokens: {
        WETH: {
          address: loaded.tokens?.WETH?.address || "0x0000000000000000000000000000000000000000",
          decimals: 18,
          symbol: "WETH",
          ...loaded.tokens?.WETH,
          ...customConfig?.tokens?.WETH,
        },
        WBTC: {
          address: loaded.tokens?.WBTC?.address || "0x0000000000000000000000000000000000000000",
          decimals: 8,
          symbol: "WBTC",
          ...loaded.tokens?.WBTC,
          ...customConfig?.tokens?.WBTC,
        },
        USDC: {
          address: loaded.tokens?.USDC?.address || "0x0000000000000000000000000000000000000000",
          decimals: 6,
          symbol: "USDC",
          ...loaded.tokens?.USDC,
          ...customConfig?.tokens?.USDC,
        },
      },
      uniswapV4: {
        routeId: loaded.uniswapV4?.routeId || "0x0000000000000000000000000000000000000000000000000000000000000000",
        currency0: loaded.uniswapV4?.currency0 || "0x0000000000000000000000000000000000000000",
        currency1: loaded.uniswapV4?.currency1 || "0x0000000000000000000000000000000000000000",
        fee: loaded.uniswapV4?.fee || 0x800000,
        tickSpacing: loaded.uniswapV4?.tickSpacing || 60,
        hooks: loaded.uniswapV4?.hooks || "0x00000000000000000000000000000000000000c8",
        ...loaded.uniswapV4,
        ...customConfig?.uniswapV4,
      },
      accounts: {
        deployer: loaded.accounts?.deployer || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        lp: loaded.accounts?.lp || loaded.accounts?.elpi1 || "0xf85B008086EA4f59f17aE9E0665962a1e45c7855",
        taker: loaded.accounts?.taker || loaded.accounts?.elpi2 || "0x61755DF0a398ee315bcC077d99B5eaC7c73ca813",
        taker2: loaded.accounts?.taker2 || loaded.accounts?.elpi3 || "0xEB1b98c730a0fA3F3419cb201D343D509767865b",
        maker2: loaded.accounts?.maker2 || loaded.accounts?.elpi4 || "0x4A60DB79Eede5e98f8b71f78D1b6d311ECDD8885",
        feeVault: loaded.accounts?.feeVault || loaded.accounts?.elpi5 || "0x6C02839e831b680aB61D5De8AfF676e9a878e825",
        elpi1: loaded.accounts?.elpi1 || "0xf85B008086EA4f59f17aE9E0665962a1e45c7855",
        elpi2: loaded.accounts?.elpi2 || "0x61755DF0a398ee315bcC077d99B5eaC7c73ca813",
        elpi3: loaded.accounts?.elpi3 || "0xEB1b98c730a0fA3F3419cb201D343D509767865b",
        elpi4: loaded.accounts?.elpi4 || "0x4A60DB79Eede5e98f8b71f78D1b6d311ECDD8885",
        elpi5: loaded.accounts?.elpi5 || "0x6C02839e831b680aB61D5De8AfF676e9a878e825",
        anvilLp: loaded.accounts?.anvilLp || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        anvilTaker: loaded.accounts?.anvilTaker || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        ...loaded.accounts,
        ...customConfig?.accounts,
      },
    };
  }

  public resolveRecipient(recipientInput: string): string {
    const lower = recipientInput.toLowerCase().trim();
    const acc = this.config.accounts;
    if (lower === "lp" || lower === "elpi1" || lower === "alice") {
      return acc.elpi1 || acc.lp;
    }
    if (lower === "taker" || lower === "taker1" || lower === "elpi2" || lower === "bob") {
      return acc.elpi2 || acc.taker;
    }
    if (lower === "taker2" || lower === "elpi3" || lower === "charlie") {
      return acc.elpi3 || acc.taker2 || acc.taker;
    }
    if (lower === "maker2" || lower === "lp2" || lower === "elpi4") {
      return acc.elpi4 || acc.maker2 || acc.lp;
    }
    if (lower === "feevault" || lower === "fee" || lower === "elpi5") {
      return acc.elpi5 || acc.feeVault;
    }
    if (lower === "deployer" || lower === "admin" || lower === "gov") {
      return acc.deployer;
    }
    if (lower === "anvillp") {
      return acc.anvilLp || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    }
    if (lower === "anviltaker") {
      return acc.anvilTaker || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    }
    if (lower === "vault" || lower === "v4vault") {
      return this.config.contracts.v4LiquidityVault;
    }
    if (lower === "pm" || lower === "poolmanager") {
      return this.config.contracts.poolManager;
    }
    if (lower === "venue" || lower === "mockvenue") {
      return this.config.contracts.mockSettlementVenue;
    }
    return recipientInput;
  }

  // ─── RPC Helpers ─────────────────────────────────────────────────────────────

  public async rpcCall<T = any>(method: string, params: any[] = []): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });

    if (!res.ok) {
      throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`RPC error (${method}): ${data.error.message || JSON.stringify(data.error)}`);
    }

    return data.result;
  }

  public castCall(target: string, sig: string, ...args: string[]): string {
    const formattedArgs = args.length > 0 ? " " + args.join(" ") : "";
    const cmd = `cast call ${target} "${sig}"${formattedArgs} --rpc-url ${this.rpcUrl}`;
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    return out.split(/\s+/)[0] || "0";
  }

  public castSend(target: string, sig: string, ...args: string[]): string {
    const formattedArgs = args.join(" ");
    const cmd = `cast send ${target} "${sig}" ${formattedArgs} --private-key ${this.deployerKey} --rpc-url ${this.rpcUrl}`;
    return execSync(cmd, { encoding: "utf8" }).trim();
  }

  public async getLatestBlock(): Promise<{ number: number; timestamp: number }> {
    const block = await this.rpcCall("eth_getBlockByNumber", ["latest", false]);
    return {
      number: parseInt(block.number, 16),
      timestamp: parseInt(block.timestamp, 16),
    };
  }

  // ─── Logic 1: Atomic Price & Settlement Venue Rate Synchronization ────────────

  public async setPrice(assetInput: string, valueInput: string): Promise<PriceResult> {
    const asset = assetInput.toUpperCase();
    const isWeth = asset === "WETH" || asset === "ETH";
    const isWbtc = asset === "WBTC" || asset === "BTC";

    if (!isWeth && !isWbtc) {
      throw new Error(`Unsupported asset: ${assetInput}. Valid assets: WETH, WBTC.`);
    }

    const oracleAddress = isWeth ? this.config.contracts.wethOracle : this.config.contracts.wbtcOracle;
    const token = isWeth ? this.config.tokens.WETH : this.config.tokens.WBTC;
    const settlementToken = this.config.tokens.USDC;
    const venueAddress = this.config.contracts.mockSettlementVenue;

    if (!oracleAddress || oracleAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error(`Oracle address for ${asset} not configured in local-anvil.json`);
    }

    // 1. Read current price from oracle (1e18 scale)
    const rawCurPrice = this.castCall(oracleAddress, "mockPrice()(uint256)");
    const curPrice1e18 = BigInt(rawCurPrice);

    // 2. Read latest block timestamp
    const { timestamp: now } = await this.getLatestBlock();

    // 3. Compute new price with arbitrary precision
    let newPrice1e18: bigint;
    const valTrimmed = valueInput.trim();

    if (valTrimmed.startsWith("+") || valTrimmed.startsWith("-") || valTrimmed.endsWith("%")) {
      // Relative percentage change, e.g. "+5%", "-3.5%", "+10"
      const pctStr = valTrimmed.replace("%", "").trim();
      const pctFloat = parseFloat(pctStr);
      if (isNaN(pctFloat)) {
        throw new Error(`Invalid percentage shift: ${valueInput}`);
      }

      // Convert percentage to basis points (1 bp = 0.01%, 10000 bps = 100%)
      const bps = BigInt(Math.round(pctFloat * 100));
      newPrice1e18 = (curPrice1e18 * (10000n + bps)) / 10000n;
    } else {
      // Absolute price, e.g. "3200", "3250.5"
      const absFloat = parseFloat(valTrimmed);
      if (isNaN(absFloat) || absFloat <= 0) {
        throw new Error(`Invalid absolute price: ${valueInput}`);
      }
      newPrice1e18 = this.parseUnitsTo1e18(valTrimmed);
    }

    // 4. Synchronize Settlement Venue Exchange Rate
    // numerator = (newPrice1e18 * 10^settlementDecimals) / 10^18
    // denominator = 10^collateralDecimals
    const numerator = (newPrice1e18 * 10n ** BigInt(settlementToken.decimals)) / 10n ** 18n;
    const denominator = 10n ** BigInt(token.decimals);

    // 5. Broadcast updates atomically
    // Set Oracle price and updatedAt
    const oracleTx = this.castSend(oracleAddress, "setPrice(uint256,uint256)", newPrice1e18.toString(), now.toString());

    // Set Venue exchange rate
    let venueTx: string | undefined;
    if (venueAddress && venueAddress !== "0x0000000000000000000000000000000000000000") {
      venueTx = this.castSend(venueAddress, "setRate(uint256,uint256)", numerator.toString(), denominator.toString());
    }

    const oldUsd = this.format1e18ToUsd(curPrice1e18);
    const newUsd = this.format1e18ToUsd(newPrice1e18);

    return {
      asset,
      oldPriceUsd: oldUsd,
      newPriceUsd: newUsd,
      newPrice1e18: newPrice1e18.toString(),
      numerator: numerator.toString(),
      denominator: denominator.toString(),
      oracleTxHash: oracleTx,
      venueTxHash: venueTx,
      timestamp: now,
    };
  }

  // ─── Logic 2: Time-Travel and Staleness Decoupling ─────────────────────────────

  public async advance(durationInput: string): Promise<AdvanceResult> {
    const seconds = this.parseDuration(durationInput);
    const { timestamp: oldTimestamp } = await this.getLatestBlock();

    await this.rpcCall("evm_increaseTime", [seconds]);
    await this.rpcCall("evm_mine", []);

    const { timestamp: newTimestamp } = await this.getLatestBlock();

    return {
      seconds,
      oldTimestamp,
      newTimestamp,
      isoDate: new Date(newTimestamp * 1000).toISOString(),
      staleWarning: seconds > 60, // Flag warning if jumped forward noticeably
    };
  }

  public async refresh(): Promise<RefreshResult> {
    const { timestamp: now } = await this.getLatestBlock();
    const oraclesRefreshed: Array<{ asset: string; priceUsd: string; address: string }> = [];

    const pairs = [
      { asset: "WETH", address: this.config.contracts.wethOracle },
      { asset: "WBTC", address: this.config.contracts.wbtcOracle },
    ];

    for (const pair of pairs) {
      if (pair.address && pair.address !== "0x0000000000000000000000000000000000000000") {
        try {
          const rawPrice = this.castCall(pair.address, "mockPrice()(uint256)");
          const curPrice = BigInt(rawPrice);
          this.castSend(pair.address, "setPrice(uint256,uint256)", curPrice.toString(), now.toString());
          oraclesRefreshed.push({
            asset: pair.asset,
            priceUsd: this.format1e18ToUsd(curPrice),
            address: pair.address,
          });
        } catch (err) {
          console.warn(`[WARN] Could not refresh ${pair.asset} oracle: ${(err as Error).message}`);
        }
      }
    }

    return {
      timestamp: now,
      isoDate: new Date(now * 1000).toISOString(),
      oraclesRefreshed,
    };
  }

  // ─── Logic 3: Persona & Balance Inspection ────────────────────────────────────

  public async getStatus(): Promise<StatusResult> {
    const { number: blockNumber, timestamp } = await this.getLatestBlock();

    // 1. Inspect Oracles
    const prices: StatusResult["prices"] = [];
    const oracleDefs = [
      { asset: "WETH", address: this.config.contracts.wethOracle },
      { asset: "WBTC", address: this.config.contracts.wbtcOracle },
    ];

    for (const item of oracleDefs) {
      if (item.address && item.address !== "0x0000000000000000000000000000000000000000") {
        try {
          const rawPrice = BigInt(this.castCall(item.address, "mockPrice()(uint256)"));
          const rawUpdated = parseInt(this.castCall(item.address, "mockUpdatedAt()(uint256)"), 10);
          const age = timestamp - rawUpdated;

          prices.push({
            asset: item.asset,
            priceUsd: this.format1e18ToUsd(rawPrice),
            updatedAt: rawUpdated,
            ageSeconds: age,
            isFresh: age >= 0 && age <= MAX_PRICE_AGE_SECONDS,
            oracleAddress: item.address,
          });
        } catch {
          // Skip if call failed
        }
      }
    }

    // 2. Inspect Settlement Venue
    const venueAddr = this.config.contracts.mockSettlementVenue;
    let venueStatus: StatusResult["venue"] = {
      address: venueAddr,
      rateNumerator: "0",
      rateDenominator: "0",
      effectiveWethRate: "0.0",
      usdcReserve: "0.0",
      wethReserve: "0.0",
      wbtcReserve: "0.0",
    };

    if (venueAddr && venueAddr !== "0x0000000000000000000000000000000000000000") {
      try {
        const num = this.castCall(venueAddr, "rateNumerator()(uint256)");
        const den = this.castCall(venueAddr, "rateDenominator()(uint256)");
        const numBig = BigInt(num);
        const denBig = BigInt(den);

        // Effective rate = (numerator / 1e6) / (denominator / 1e18) = (numerator * 1e12) / denominator
        const effectiveRate = denBig > 0n ? (Number(numBig) / 1e6) / (Number(denBig) / 1e18) : 0;

        const usdcBal = await this.getTokenBalance(this.config.tokens.USDC.address, venueAddr, 6);
        const wethBal = await this.getTokenBalance(this.config.tokens.WETH.address, venueAddr, 18);
        const wbtcBal = await this.getTokenBalance(this.config.tokens.WBTC.address, venueAddr, 8);

        venueStatus = {
          address: venueAddr,
          rateNumerator: num,
          rateDenominator: den,
          effectiveWethRate: effectiveRate.toFixed(2),
          usdcReserve: usdcBal,
          wethReserve: wethBal,
          wbtcReserve: wbtcBal,
        };
      } catch {
        // Venue inspect fallback
      }
    }

    // 3. Inspect V4 Liquidity Vault & Staged Liquidity
    const vaultAddr = this.config.contracts.v4LiquidityVault;
    let v4VaultStatus: StatusResult["v4Vault"] = undefined;
    if (vaultAddr && vaultAddr !== "0x0000000000000000000000000000000000000000") {
      try {
        const owner = this.castCall(vaultAddr, "owner()(address)");
        const lpRouter = this.castCall(vaultAddr, "lpRouter()(address)");
        const tickLower = parseInt(this.castCall(vaultAddr, "tickLower()(int24)"), 10) || 600;
        const tickUpper = parseInt(this.castCall(vaultAddr, "tickUpper()(int24)"), 10) || 1200;
        const liquidWeth = await this.getTokenBalance(this.config.tokens.WETH.address, vaultAddr, 18);
        const stagedPmWeth = await this.getTokenBalance(
          this.config.tokens.WETH.address,
          this.config.contracts.poolManager,
          18
        );
        const rawPending = this.castCall(vaultAddr, "pendingAsset(address)(uint256)", this.config.tokens.WETH.address);
        const pendingAssetWeth = (Number(BigInt(rawPending)) / 1e18).toFixed(4);

        v4VaultStatus = {
          address: vaultAddr,
          owner,
          lpRouter,
          tickLower,
          tickUpper,
          liquidWeth,
          stagedPoolManagerWeth: stagedPmWeth,
          pendingAssetWeth,
        };
      } catch {
        // Vault inspect fallback
      }
    }

    // 4. Inspect Personas & Protocol Accounts
    const personas: BalanceEntry[] = [];
    const accounts = [
      { name: "LP / Maker (elpi1)", address: this.config.accounts.elpi1 || this.config.accounts.lp },
      { name: "Taker 1 (elpi2)", address: this.config.accounts.elpi2 || this.config.accounts.taker },
      { name: "Taker 2 (elpi3)", address: this.config.accounts.elpi3 || this.config.accounts.taker2 || "" },
      { name: "Secondary LP (elpi4)", address: this.config.accounts.elpi4 || this.config.accounts.maker2 || "" },
      { name: "Fee Vault (elpi5)", address: this.config.accounts.elpi5 || this.config.accounts.feeVault },
      { name: "Deployer / Admin", address: this.config.accounts.deployer },
      { name: "V4 Liquidity Vault", address: this.config.contracts.v4LiquidityVault },
      { name: "V4 PoolManager", address: this.config.contracts.poolManager },
      { name: "Anvil LP (0x7099)", address: this.config.accounts.anvilLp || "" },
      { name: "Anvil Taker (0x3C44)", address: this.config.accounts.anvilTaker || "" },
    ];

    for (const acc of accounts) {
      if (acc.address && acc.address !== "0x0000000000000000000000000000000000000000") {
        const ethRaw = await this.rpcCall("eth_getBalance", [acc.address, "latest"]);
        const eth = (Number(BigInt(ethRaw)) / 1e18).toFixed(4);
        const weth = await this.getTokenBalance(this.config.tokens.WETH.address, acc.address, 18);
        const wbtc = await this.getTokenBalance(this.config.tokens.WBTC.address, acc.address, 8);
        const usdc = await this.getTokenBalance(this.config.tokens.USDC.address, acc.address, 6);

        personas.push({
          name: acc.name,
          address: acc.address,
          eth,
          weth,
          wbtc,
          usdc,
        });
      }
    }

    return {
      blockNumber,
      timestamp,
      isoDate: new Date(timestamp * 1000).toISOString(),
      prices,
      venue: venueStatus,
      v4Vault: v4VaultStatus,
      uniswapV4: this.config.uniswapV4,
      personas,
    };
  }

  // ─── Token Mint / Faucet ──────────────────────────────────────────────────────

  public async mint(assetInput: string, recipient: string, amountInput: string): Promise<string> {
    const resolvedRecipient = this.resolveRecipient(recipient);
    const asset = assetInput.toUpperCase();
    const token =
      asset === "WETH"
        ? this.config.tokens.WETH
        : asset === "WBTC"
        ? this.config.tokens.WBTC
        : asset === "USDC"
        ? this.config.tokens.USDC
        : null;

    if (!token || !token.address || token.address === "0x0000000000000000000000000000000000000000") {
      throw new Error(`Token ${assetInput} not configured`);
    }

    const rawUnits = this.parseUnits(amountInput, token.decimals);
    const tx = this.castSend(token.address, "mint(address,uint256)", resolvedRecipient, rawUnits.toString());
    return tx;
  }

  // ─── Format & Parse Utilities ─────────────────────────────────────────────────

  public parseDuration(duration: string): number {
    const match = duration.trim().match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day|w|week)?$/i);
    if (!match) {
      const parsedInt = parseInt(duration, 10);
      if (!isNaN(parsedInt)) return parsedInt;
      throw new Error(`Invalid duration format: "${duration}". Examples: "30m", "1h", "2d", "3600".`);
    }

    const val = parseFloat(match[1]);
    const unit = (match[2] || "s").toLowerCase();

    switch (unit) {
      case "s":
      case "sec":
        return Math.round(val);
      case "m":
      case "min":
        return Math.round(val * 60);
      case "h":
      case "hr":
        return Math.round(val * 3600);
      case "d":
      case "day":
        return Math.round(val * 86400);
      case "w":
      case "week":
        return Math.round(val * 604800);
      default:
        return Math.round(val);
    }
  }

  public parseUnitsTo1e18(amountStr: string): bigint {
    return this.parseUnits(amountStr, 18);
  }

  public parseUnits(amountStr: string, decimals: number): bigint {
    const parts = amountStr.trim().split(".");
    const whole = parts[0] || "0";
    const fraction = parts[1] || "";

    const wholeBig = BigInt(whole) * 10n ** BigInt(decimals);
    if (fraction.length === 0) return wholeBig;

    const paddedFraction = fraction.slice(0, decimals).padEnd(decimals, "0");
    const fracBig = BigInt(paddedFraction);
    return wholeBig + fracBig;
  }

  public format1e18ToUsd(price1e18: bigint): string {
    const whole = price1e18 / 10n ** 18n;
    const frac = (price1e18 % 10n ** 18n) / 10n ** 16n; // 2 decimal places
    return `${whole}.${frac.toString().padStart(2, "0")}`;
  }

  private async getTokenBalance(tokenAddress: string, holder: string, decimals: number): Promise<string> {
    if (!tokenAddress || tokenAddress === "0x0000000000000000000000000000000000000000") return "0.00";
    try {
      const raw = this.castCall(tokenAddress, "balanceOf(address)(uint256)", holder);
      const rawBig = BigInt(raw);
      const scale = 10n ** BigInt(decimals);
      const whole = rawBig / scale;
      const frac = (rawBig % scale) / 10n ** BigInt(Math.max(0, decimals - 2));
      return `${whole}.${frac.toString().padStart(2, "0")}`;
    } catch {
      return "0.00";
    }
  }
}

// ─── Exported Convenience Functions for E2E / Playwright ───────────────────────

let defaultInstance: DevConsole | null = null;
function getInstance(): DevConsole {
  if (!defaultInstance) {
    defaultInstance = new DevConsole();
  }
  return defaultInstance;
}

export async function setPrice(asset: string, value: string | number): Promise<PriceResult> {
  return getInstance().setPrice(asset, value.toString());
}

export async function advanceTime(duration: string | number): Promise<AdvanceResult> {
  return getInstance().advance(duration.toString());
}

export async function refreshOracles(): Promise<RefreshResult> {
  return getInstance().refresh();
}

export async function getDevStatus(): Promise<StatusResult> {
  return getInstance().getStatus();
}

export async function mintTokens(asset: string, recipient: string, amount: string | number): Promise<string> {
  return getInstance().mint(asset, recipient, amount.toString());
}

// ─── Launch Dashboard ─────────────────────────────────────────────────────────

async function printLaunchDashboard(instance: DevConsole): Promise<void> {
  console.log("\n==========================================================================================================");
  console.log("  elpi (elpi.xyz) × Uniswap v4 Development & Testing Console");
  console.log(`  RPC Target: ${instance.rpcUrl}  |  Chain ID: ${instance.config.chainId}`);
  console.log("==========================================================================================================");

  try {
    const s = await instance.getStatus();

    console.log(`\n─── Mock Personas & Test Accounts ────────────────────────────────────────────────────────────────────────`);
    console.log(`  LP / Maker (elpi1)     : ${instance.config.accounts.elpi1 || instance.config.accounts.lp} (staged in V4 vault)`);
    console.log(`  Taker 1 (elpi2)        : ${instance.config.accounts.elpi2 || instance.config.accounts.taker} (funded with pre-approvals)`);
    console.log(`  Taker 2 (elpi3)        : ${instance.config.accounts.elpi3 || instance.config.accounts.taker2 || "N/A"} (funded with pre-approvals)`);
    console.log(`  Secondary LP (elpi4)   : ${instance.config.accounts.elpi4 || instance.config.accounts.maker2 || "N/A"}`);
    console.log(`  Fee Vault (elpi5)      : ${instance.config.accounts.elpi5 || instance.config.accounts.feeVault}`);
    console.log(`  Deployer / Admin       : ${instance.config.accounts.deployer}`);

    if (s.v4Vault) {
      console.log(`\n─── Uniswap v4 Liquidity Vault & Staged Position ─────────────────────────────────────────────────────────`);
      console.log(`  Vault Contract  : ${s.v4Vault.address}`);
      console.log(`  Vault Owner     : ${s.v4Vault.owner}`);
      console.log(`  Tick Range      : [${s.v4Vault.tickLower}, ${s.v4Vault.tickUpper}] (single-sided WETH collateral)`);
      console.log(`  Staged Liquidity: ${s.v4Vault.stagedPoolManagerWeth} WETH (in PoolManager) + ${s.v4Vault.liquidWeth} WETH (loose vault balance)`);
      if (s.v4Vault.pendingAssetWeth !== "0.0000") {
        console.log(`  Pending Restake : ${s.v4Vault.pendingAssetWeth} WETH`);
      }
    }

    console.log(`\n─── Spot Oracles & Freshness ─────────────────────────────────────────────────────────────────────────────`);
    for (const p of s.prices) {
      const statusBadge = p.isFresh
        ? `\x1b[32m[FRESH]\x1b[0m (age: ${p.ageSeconds}s)`
        : `\x1b[31m[STALE]\x1b[0m (age: ${p.ageSeconds}s, max: ${MAX_PRICE_AGE_SECONDS}s)`;
      console.log(`  ${p.asset.padEnd(5)}: $${p.priceUsd.padStart(9)}  ${statusBadge}  (${p.oracleAddress})`);
    }

    console.log(`\n─── Persona & Vault Balances ─────────────────────────────────────────────────────────────────────────────`);
    console.log(
      `  ${"Persona / Role".padEnd(24)} ${"Address".padEnd(44)} ${"ETH".padEnd(10)} ${"WETH".padEnd(12)} ${"WBTC".padEnd(10)} ${"USDC".padEnd(12)}`
    );
    console.log(`  ${"─".repeat(116)}`);
    for (const p of s.personas) {
      console.log(
        `  ${p.name.padEnd(24)} ${p.address.padEnd(44)} ${p.eth.padEnd(10)} ${p.weth.padEnd(12)} ${p.wbtc.padEnd(10)} ${p.usdc.padEnd(12)}`
      );
    }
  } catch (err) {
    console.warn(`[WARN] Could not retrieve initial chain status: ${(err as Error).message}`);
  }

  console.log("\n==========================================================================================================");
  console.log("  Quick Commands: price weth 3200 | advance 1h | refresh | mint usdc 1000 elpi2 | status | quotes | help");
  console.log("==========================================================================================================\n");
}

// ─── Interactive REPL & CLI Runner ─────────────────────────────────────────────

async function runCli(): Promise<void> {
  const consoleInstance = new DevConsole();
  const args = process.argv.slice(2);

  // Programmatic execution if command-line args supplied
  if (args.length > 0) {
    await handleCommand(consoleInstance, args);
    process.exit(0);
  }

  // Display initial mock addresses and data on launch
  await printLaunchDashboard(consoleInstance);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36melpi>\x1b[0m ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      const parts = trimmed.split(/\s+/);
      try {
        await handleCommand(consoleInstance, parts);
      } catch (err) {
        console.error(`\x1b[31m[ERROR]\x1b[0m ${(err as Error).message}`);
      }
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n[Dev Console] Exiting session.");
    process.exit(0);
  });
}

async function handleCommand(instance: DevConsole, parts: string[]): Promise<void> {
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "price": {
      if (parts.length < 3) {
        console.log("Usage: price <asset> <value>");
        console.log("Examples: price weth 3200 | price weth +5% | price wbtc -3.5%");
        return;
      }
      const asset = parts[1];
      const val = parts[2];
      const res = await instance.setPrice(asset, val);
      console.log(`\n\x1b[32m[PRICE SYNC]\x1b[0m ${res.asset} Spot Price: $${res.oldPriceUsd} ➔ \x1b[1m$${res.newPriceUsd}\x1b[0m`);
      console.log(`  Oracle setPrice: ${res.newPrice1e18} (timestamp: ${res.timestamp})`);
      console.log(`  Venue setRate  : numerator=${res.numerator}, denominator=${res.denominator}`);
      break;
    }

    case "advance": {
      if (parts.length < 2) {
        console.log("Usage: advance <duration>");
        console.log("Examples: advance 1h | advance 30m | advance 2d | advance 3600");
        return;
      }
      const duration = parts[1];
      const res = await instance.advance(duration);
      console.log(`\n\x1b[33m[TIME ADVANCE]\x1b[0m Moved clock forward by ${res.seconds}s (${duration}).`);
      console.log(`  Current block.timestamp: ${res.newTimestamp} (${res.isoDate})`);
      if (res.staleWarning) {
        console.log(`  \x1b[33m⚠️ Warning: Oracle timestamp is now stale. Run 'refresh' if transactions revert with PriceNotFresh.\x1b[0m`);
      }
      break;
    }

    case "refresh": {
      const res = await instance.refresh();
      console.log(`\n\x1b[32m[REFRESH]\x1b[0m Refreshed all oracles to block.timestamp ${res.timestamp} (${res.isoDate}).`);
      for (const o of res.oraclesRefreshed) {
        console.log(`  ${o.asset}: $${o.priceUsd} (freshness restored)`);
      }
      break;
    }

    case "status": {
      const s = await instance.getStatus();
      console.log(`\n─── Chain State ──────────────────────────────────────────`);
      console.log(`  Block Number : #${s.blockNumber}`);
      console.log(`  Timestamp    : ${s.timestamp} (${s.isoDate})`);

      console.log(`\n─── Spot Oracles & Freshness ─────────────────────────────`);
      for (const p of s.prices) {
        const statusBadge = p.isFresh
          ? `\x1b[32m[FRESH]\x1b[0m (age: ${p.ageSeconds}s)`
          : `\x1b[31m[STALE]\x1b[0m (age: ${p.ageSeconds}s, max: ${MAX_PRICE_AGE_SECONDS}s)`;
        console.log(`  ${p.asset.padEnd(5)}: $${p.priceUsd.padStart(9)}  ${statusBadge}  oracle: ${p.oracleAddress}`);
      }

      if (s.uniswapV4) {
        console.log(`\n─── Uniswap v4 Pool Parameters ───────────────────────────`);
        console.log(`  Route ID     : ${s.uniswapV4.routeId}`);
        const c0Symbol = s.uniswapV4.currency0.toLowerCase() === instance.config.tokens.WETH.address.toLowerCase() ? "WETH" : "USDC";
        const c1Symbol = s.uniswapV4.currency1.toLowerCase() === instance.config.tokens.WETH.address.toLowerCase() ? "WETH" : "USDC";
        console.log(`  Currency0    : ${s.uniswapV4.currency0} (${c0Symbol})`);
        console.log(`  Currency1    : ${s.uniswapV4.currency1} (${c1Symbol})`);
        console.log(`  Pool Fee     : ${s.uniswapV4.fee} (Dynamic Fee Flag / 0x800000)`);
        console.log(`  Tick Spacing : ${s.uniswapV4.tickSpacing}`);
        console.log(`  Hook Address : ${s.uniswapV4.hooks}`);
      }

      if (s.v4Vault) {
        console.log(`\n─── Uniswap v4 Liquidity Vault & Staged Position ─────────`);
        console.log(`  Vault Address: ${s.v4Vault.address}`);
        console.log(`  Owner (LP)   : ${s.v4Vault.owner}`);
        console.log(`  Router       : ${s.v4Vault.lpRouter}`);
        console.log(`  Tick Range   : [${s.v4Vault.tickLower}, ${s.v4Vault.tickUpper}]`);
        console.log(`  Staged in PM : ${s.v4Vault.stagedPoolManagerWeth} WETH`);
        console.log(`  Liquid WETH  : ${s.v4Vault.liquidWeth} WETH`);
        console.log(`  Pending Asset: ${s.v4Vault.pendingAssetWeth} WETH`);
      }

      console.log(`\n─── Settlement Venue State ───────────────────────────────`);
      console.log(`  Venue Address   : ${s.venue.address}`);
      console.log(`  Exchange Rate   : ${s.venue.rateNumerator} / ${s.venue.rateDenominator} (~${s.venue.effectiveWethRate} USDC/WETH)`);
      console.log(`  Reserves        : ${s.venue.usdcReserve} USDC | ${s.venue.wethReserve} WETH | ${s.venue.wbtcReserve} WBTC`);

      console.log(`\n─── Persona & Vault Balances ─────────────────────────────`);
      console.log(
        `  ${"Name".padEnd(24)} ${"Address".padEnd(44)} ${"ETH".padEnd(10)} ${"WETH".padEnd(12)} ${"WBTC".padEnd(10)} ${"USDC".padEnd(12)}`
      );
      console.log(`  ${"─".repeat(116)}`);
      for (const p of s.personas) {
        console.log(
          `  ${p.name.padEnd(24)} ${p.address.padEnd(44)} ${p.eth.padEnd(10)} ${p.weth.padEnd(12)} ${p.wbtc.padEnd(10)} ${p.usdc.padEnd(12)}`
        );
      }
      console.log("");
      break;
    }

    case "quotes": {
      const quotesPath = path.resolve(process.cwd(), "script/output/seeded-quotes.json");
      if (!fs.existsSync(quotesPath)) {
        console.log("No seeded quotes found. Run './dev.sh seed' or 'bash script/seed-liquidity.sh'.");
        return;
      }
      try {
        const raw = fs.readFileSync(quotesPath, "utf8");
        const data = JSON.parse(raw);
        console.log(`\n─── Seeded Backer Quotes (ERC-1271 Verified) ─────────────`);
        console.log(`  Generated At: ${data.isoDate} (${data.timestamp})`);
        console.log(`  Vault       : ${data.vault}`);
        console.log(`  Signer (LP) : ${data.lpOwner}\n`);
        for (const q of data.quotes) {
          const status = q.erc1271Valid ? "\x1b[32m[VALID ERC-1271]\x1b[0m" : "\x1b[31m[INVALID]\x1b[0m";
          console.log(`  ${q.id} ${status}`);
          console.log(`    Type: ${q.type} | Strike: $${q.strikeUsd} | Premium: $${q.premiumUsd} | Capacity: ${q.capacityFormatted}`);
          console.log(`    Expiry: ${q.expiryDate} (${q.expiry})`);
          console.log(`    Digest: ${q.digest}`);
          console.log(`    Signature: ${q.signature.slice(0, 22)}...${q.signature.slice(-12)}\n`);
        }
      } catch (err) {
        console.error(`Failed to read quotes: ${(err as Error).message}`);
      }
      break;
    }

    case "faucet":
    case "mint": {
      if (parts.length < 3) {
        console.log("Usage: mint <asset> <amount> [recipient]");
        console.log("Examples: mint weth 10 elpi2 | mint usdc 50000 elpi1 | mint wbtc 2 elpi3");
        console.log("Aliases: elpi1, elpi2, elpi3, elpi4, elpi5, lp, taker, taker2, deployer, vault, pm");
        return;
      }
      const asset = parts[1];
      const amount = parts[2];
      const rawRecipient = parts[3] || "deployer";
      const resolved = instance.resolveRecipient(rawRecipient);
      await instance.mint(asset, rawRecipient, amount);
      console.log(`\x1b[32m[MINT]\x1b[0m Minted ${amount} ${asset.toUpperCase()} to ${rawRecipient} (${resolved})`);
      break;
    }

    case "help": {
      console.log(`\nAvailable Commands:`);
      console.log(`  price <asset> <val>     : Atomic price & venue rate sync (e.g. price weth 3200, price weth +5%)`);
      console.log(`  advance <duration>      : Fast-forward EVM clock (e.g. advance 1h, advance 30m, advance 2d)`);
      console.log(`  refresh                 : Clear oracle staleness by stamping current block.timestamp`);
      console.log(`  status                  : Display chain state, spot prices, v4 vault position, and persona balances`);
      console.log(`  quotes                  : Inspect active seeded quotes with ERC-1271 validation status`);
      console.log(`  mint <asset> <amt> [to] : Mint mock tokens to specified address or persona alias (e.g. elpi1, elpi2)`);
      console.log(`  help                    : Show this help manual`);
      console.log(`  exit / quit             : Exit the console\n`);
      break;
    }

    case "exit":
    case "quit": {
      process.exit(0);
      break;
    }

    default: {
      console.log(`Unknown command: "${cmd}". Type 'help' for available commands.`);
    }
  }
}

import { fileURLToPath } from "node:url";

const isMainModule = Boolean(
  process.argv[1] &&
    (process.argv[1] === fileURLToPath(import.meta.url) ||
      process.argv[1].endsWith("dev-console.ts") ||
      process.argv[1].endsWith("dev-console"))
);

if (isMainModule) {
  runCli().catch((err) => {
    console.error("[FATAL]", err);
    process.exit(1);
  });
}
