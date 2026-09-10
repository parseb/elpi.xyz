import { createConfig, http, fallback } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { anvilLocal, base, baseSepolia, isDev } from "./chain";
import { createDevConnectors } from "./devWalletConnector";
 
// Base is the primary production chain with batched transport to prevent 413 errors.
export const wagmiConfig = createConfig({
  chains: isDev ? [anvilLocal, base, baseSepolia] : [base, baseSepolia],
  connectors: [
    injected(),
    coinbaseWallet({
      appName: "elpi.xyz (Uniswap v4)",
    }),
    ...(isDev ? createDevConnectors() : []),
  ],
  transports: {
    [anvilLocal.id]: http(process.env.NEXT_PUBLIC_DEV_RPC_URL || "http://127.0.0.1:8545", {
      batch: { batchSize: 50, wait: 16 },
    }),
    [31337]: http(process.env.NEXT_PUBLIC_DEV_RPC_URL || "http://127.0.0.1:8545", {
      batch: { batchSize: 50, wait: 16 },
    }),
    [8453]: isDev && anvilLocal.id === 8453
      ? http(process.env.NEXT_PUBLIC_DEV_RPC_URL || "http://127.0.0.1:8545", {
          batch: { batchSize: 50, wait: 16 },
        })
      : fallback([
          http(process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org", {
            batch: {
              batchSize: 20,
              wait: 32,
            },
          }),
          http("https://base-rpc.publicnode.com", {
            batch: {
              batchSize: 20,
              wait: 32,
            },
          }),
          http("https://1rpc.io/base", {
            batch: {
              batchSize: 20,
              wait: 32,
            },
          }),
        ]),
    [baseSepolia.id]: http("https://sepolia.base.org", {
      batch: { batchSize: 20, wait: 32 },
    }),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
