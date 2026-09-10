import type { Address } from "viem";

export type CounterpartyType = "Institutional MM" | "Solo Liquidity Provider" | "Automated LP Router" | "AI Agent Node" | "Yield Vault";

export interface CounterpartyInfo {
  address: Address;
  name: string;
  shortName: string;
  type: CounterpartyType;
  tag: string;
  tone: "blue" | "emerald" | "amber" | "purple" | "cyan";
  verified: boolean;
  reputationScore: string;
  description: string;
}

export const KNOWN_COUNTERPARTIES: Record<string, CounterpartyInfo> = {
  // Uniswap v4 Liquidity Vault (LP Vault staging collateral in PoolManager)
  "0x9a676e781a523b5d0c0e43731313a708cb607508": {
    address: "0x9A676e781A523b5d0C0e43731313A708CB607508",
    name: "Uniswap v4 Liquidity Vault",
    shortName: "Uniswap v4 Vault",
    type: "Yield Vault",
    tag: "v4 Staged LP",
    tone: "purple",
    verified: true,
    reputationScore: "100%",
    description: "Option collateral staged in Uniswap v4 PoolManager earning continuous AMM fees until exercised.",
  },
  // elpi1 / LP Alice
  "0xf85b008086ea4f59f17ae9e0665962a1e45c7855": {
    address: "0xf85B008086EA4f59f17aE9E0665962a1e45c7855",
    name: "elpi LP (Alice) — v4 Vault",
    shortName: "Alice (v4 LP)",
    type: "Solo Liquidity Provider",
    tag: "Uniswap v4 LP",
    tone: "emerald",
    verified: true,
    reputationScore: "99.9%",
    description: "Single-sided options liquidity backed by Uniswap v4 staged capital.",
  },
  // LP1
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": {
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    name: "Paradigm Options Desk",
    shortName: "Paradigm Desk",
    type: "Institutional MM",
    tag: "Institutional",
    tone: "blue",
    verified: true,
    reputationScore: "99.9%",
    description: "High-volume institutional market maker providing deep single-sided options liquidity.",
  },
  // LP2
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": {
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    name: "Wintermute MM Pool",
    shortName: "Wintermute",
    type: "Automated LP Router",
    tag: "Algorithmic MM",
    tone: "cyan",
    verified: true,
    reputationScore: "99.8%",
    description: "Algorithmic liquidity router quoting optimal multi-duration option rates on Base.",
  },
  // LP3
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906": {
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    name: "Amber Group Vault",
    shortName: "Amber Vault",
    type: "Yield Vault",
    tag: "Yield Staking",
    tone: "emerald",
    verified: true,
    reputationScore: "99.5%",
    description: "Decentralized options yield vault underwriting short-dated options coverage.",
  },
  // Taker 1 / Agent 1
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65": {
    address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    name: "Base AI Agent Node",
    shortName: "Base Agent",
    type: "AI Agent Node",
    tag: "Autonomous",
    tone: "purple",
    verified: true,
    reputationScore: "99.7%",
    description: "Autonomous agent execution node dynamically rebalancing liquidity through x402.",
  },
  // Taker 2 / MM 2
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc": {
    address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    name: "GSR Markets Flow",
    shortName: "GSR Markets",
    type: "Institutional MM",
    tag: "Institutional",
    tone: "blue",
    verified: true,
    reputationScore: "99.6%",
    description: "Global digital asset market maker underwriting multi-asset vanilla options.",
  },
  // Devnet LP Test Account
  "0x976ea74026e726554db657fa54763abd0c3a0aa9": {
    address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
    name: "DeFi Prime Yield LP",
    shortName: "DeFi Prime",
    type: "Solo Liquidity Provider",
    tag: "Community LP",
    tone: "amber",
    verified: true,
    reputationScore: "98.9%",
    description: "Community liquidity provider staking collateral for passive premium yield.",
  },
  // Extra MMs
  "0x14dc79964da2c08b23698b3d3cc7ca32193d9955": {
    address: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
    name: "Citadel Derivatives Desk",
    shortName: "Citadel Desk",
    type: "Institutional MM",
    tag: "Institutional",
    tone: "blue",
    verified: true,
    reputationScore: "99.9%",
    description: "Quantitative derivatives desk providing competitive spreads on major crypto assets.",
  },
  "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f": {
    address: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
    name: "Jump Crypto Alpha",
    shortName: "Jump Alpha",
    type: "Automated LP Router",
    tag: "Algorithmic MM",
    tone: "cyan",
    verified: true,
    reputationScore: "99.8%",
    description: "High-frequency market making firm underwriting options flow across major chains.",
  },
};

export function getCounterparty(address: Address | string): CounterpartyInfo {
  const key = address.toLowerCase();
  if (KNOWN_COUNTERPARTIES[key]) {
    return KNOWN_COUNTERPARTIES[key];
  }

  // Fallback for unknown address
  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return {
    address: address as Address,
    name: `LP ${shortAddr}`,
    shortName: shortAddr,
    type: "Solo Liquidity Provider",
    tag: "Solo LP",
    tone: "blue",
    verified: false,
    reputationScore: "98.0%",
    description: `Independent on-chain liquidity provider (${shortAddr}).`,
  };
}
