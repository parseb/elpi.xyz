import { defineChain } from "viem";
import { base, baseSepolia } from "viem/chains";

// Local Anvil devnet — defaults to 31337 (standard Anvil/Hardhat localhost ID)
// Using 31337 prevents external wallets (Rabby, MetaMask) from confusing local Anvil with Base Mainnet (8453)
const rawDevChainId = Number(
  process.env.NEXT_PUBLIC_DEV_CHAIN_ID ||
  process.env.NEXT_PUBLIC_CHAIN_ID ||
  31337
);

export const anvilLocal = defineChain({
  id: rawDevChainId === 8453 ? 8453 : 31337,
  name: rawDevChainId === 8453 ? "Anvil Local (Base 8453)" : "Anvil Local (31337)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"], webSocket: ["ws://127.0.0.1:8545"] },
  },
  testnet: true,
});

export { base, baseSepolia };

// Defaults to Anvil in development, and Base Mainnet in production
const rawTarget = (process.env.NEXT_PUBLIC_TARGET_CHAIN || "").toLowerCase();
const rawChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 0);

export const isDev =
  rawTarget === "anvil" ||
  rawChainId === 8453 ||
  rawChainId === 31337 ||
  (!rawTarget && process.env.NODE_ENV === "development");

export const isSepolia =
  rawTarget === "basesepolia" ||
  rawTarget === "sepolia" ||
  rawChainId === 84532;

export const targetChain = isDev
  ? anvilLocal
  : isSepolia
  ? baseSepolia
  : base;

export const environmentName = isDev
  ? "Anvil Devnet"
  : isSepolia
  ? "Base Sepolia Testnet"
  : "Base Mainnet";

