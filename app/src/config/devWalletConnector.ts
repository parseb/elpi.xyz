import { createConnector } from "wagmi";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, createPublicClient, http, numberToHex } from "viem";
import type { Address } from "viem";
import { addresses } from "./addresses";
import { isDev } from "./chain";

export interface DevAccountConfig {
  id:
    | "elpi1"
    | "elpi2"
    | "elpi3"
    | "elpi4"
    | "elpi5"
    | "deployer"
    | "anvilLp"
    | "anvilTaker"
    | "taker1"
    | "taker2"
    | "lp"
    | string;
  name: string;
  role: string;
  address: `0x${string}`;
  pk: `0x${string}`;
}

export const DEVNET_TEST_ACCOUNTS: readonly DevAccountConfig[] = [
  {
    id: "elpi1",
    name: "Alice (elpi1)",
    role: "LP Vault Owner",
    address: "0xf85B008086EA4f59f17aE9E0665962a1e45c7855",
    pk: "0xb9912f8133b56bb35ebf2baf7a62faa21e0c30f865c4e9abc599aab8bcb7e7fa",
  },
  {
    id: "elpi2",
    name: "Bob (elpi2)",
    role: "Taker 1 / Buyer",
    address: "0x61755DF0a398ee315bcC077d99B5eaC7c73ca813",
    pk: "0xfdc6e5b4548767f71e2b7b835529510d49436a578dc5b57ede07a2be0866c0b4",
  },
  {
    id: "elpi3",
    name: "Charlie (elpi3)",
    role: "Taker 2 / Settlement",
    address: "0xEB1b98c730a0fA3F3419cb201D343D509767865b",
    pk: "0x4f6640b8640a7981a1c1f13b600f848c860f51a0e33fd445713d21ced84628c5",
  },
  {
    id: "elpi4",
    name: "Dave (elpi4)",
    role: "Secondary LP",
    address: "0x4A60DB79Eede5e98f8b71f78D1b6d311ECDD8885",
    pk: "0x0f8f6c5bbc9446e503c9ce07b07061dee9df63a7b6dadbfbe4b27a07b73a681c",
  },
  {
    id: "elpi5",
    name: "Fee Vault (elpi5)",
    role: "Protocol Governance",
    address: "0x6C02839e831b680aB61D5De8AfF676e9a878e825",
    pk: "0xd2d6c980974d227a149ba5b49dc9c01d355f03d991bf53fd00d2ed27e2da527c",
  },
  {
    id: "deployer",
    name: "Deployer (Anvil #0)",
    role: "Admin / Deployer",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    pk: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    id: "anvilLp",
    name: "Paradigm Desk (Anvil #1)",
    role: "Secondary LP",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    id: "anvilTaker",
    name: "Wintermute (Anvil #2)",
    role: "Arbitrage Desk",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    pk: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
] as const;

export function createDevAccountConnector(devAcct: DevAccountConfig) {
  const account = privateKeyToAccount(devAcct.pk);

  const getIsConnected = () => {
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem("elpi_dev_connected") === devAcct.id ||
      window.localStorage.getItem("optionhood_dev_connected") === devAcct.id
    );
  };

  const setIsConnected = (val: boolean) => {
    if (typeof window === "undefined") return;
    if (val) {
      window.localStorage.setItem("elpi_dev_connected", devAcct.id);
    } else {
      window.localStorage.removeItem("elpi_dev_connected");
      window.localStorage.removeItem("optionhood_dev_connected");
    }
  };

  return createConnector((config) => ({
    id: `devnet-${devAcct.id}`,
    name: `${devAcct.name} (Dev Wallet)`,
    type: "mock",
    async setup() {},
    async connect({ chainId } = {}) {
      setIsConnected(true);
      const targetChainId = chainId ?? config.chains[0].id;
      return {
        accounts: [account.address] as readonly [Address, ...Address[]],
        chainId: targetChainId,
      } as never;
    },
    async disconnect() {
      setIsConnected(false);
    },
    async getAccounts() {
      return getIsConnected() ? ([account.address] as readonly `0x${string}`[]) : ([] as readonly `0x${string}`[]);
    },
    async getChainId() {
      return config.chains[0].id;
    },
    async isAuthorized() {
      return getIsConnected();
    },
    async switchChain({ chainId }) {
      const chain = config.chains.find((c) => c.id === chainId);
      if (!chain) throw new Error(`Chain ${chainId} not configured`);
      return chain;
    },
    onAccountsChanged(accounts) {
      config.emitter.emit("change", { accounts: accounts as readonly `0x${string}`[] });
    },
    onChainChanged(chain) {
      config.emitter.emit("change", { chainId: Number(chain) });
    },
    async onDisconnect() {
      setIsConnected(false);
      config.emitter.emit("disconnect");
    },
    async getProvider({ chainId } = {}) {
      const chain = config.chains.find((c) => c.id === chainId) ?? config.chains[0];
      const rawRpcUrl = chain.rpcUrls.default.http[0];
      const rpcUrl =
        typeof window !== "undefined" && rawRpcUrl.startsWith("/")
          ? `${window.location.origin}${rawRpcUrl}`
          : rawRpcUrl;
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
      const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

      return {
        request: async ({ method, params }: { method: string; params?: readonly unknown[] | unknown[] }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return [account.address];
          }
          if (method === "eth_chainId") {
            return numberToHex(chain.id);
          }
          if (method === "personal_sign") {
            const [message] = (params || []) as [string];
            return account.signMessage({ message });
          }
          if (method === "eth_signTypedData_v4") {
            const [, data] = (params || []) as [string, string | object];
            const parsed = typeof data === "string" ? JSON.parse(data) : data;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return account.signTypedData(parsed as any);
          }
          if (method === "eth_sendTransaction") {
            const [txParams] = (params || []) as [Parameters<typeof walletClient.sendTransaction>[0]];
            return walletClient.sendTransaction({
              ...txParams,
              account,
              chain,
            });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (publicClient.transport as any).request({ method, params });
        },
        on: () => {},
        removeListener: () => {},
      };
    },
  }));
}

export function createDevConnectors() {
  return DEVNET_TEST_ACCOUNTS.map((acct) => createDevAccountConnector(acct));
}

if (typeof window !== "undefined" && isDev) {
  const privateKeys = Object.fromEntries(
    DEVNET_TEST_ACCOUNTS.map((a) => [a.id, a.pk])
  ) as Record<string, `0x${string}`>;

  const logKeys = () => {
    console.group("🔑 [elpi dev console] Devnet Accounts & Private Keys");
    console.table(
      DEVNET_TEST_ACCOUNTS.map((a) => ({
        ID: a.id,
        Name: a.name,
        Role: a.role,
        Address: a.address,
        PrivateKey: a.pk,
      }))
    );
    console.groupEnd();
  };

  const devObject = {
    accounts: DEVNET_TEST_ACCOUNTS,
    privateKeys,
    addresses,
    logKeys,
  };

  (window as unknown as { __ELPI_DEV__?: unknown; __OPTIONHOOD_DEV__?: unknown }).__ELPI_DEV__ = devObject;
  (window as unknown as { __ELPI_DEV__?: unknown; __OPTIONHOOD_DEV__?: unknown }).__OPTIONHOOD_DEV__ = devObject;

  console.info(
    "🔑 [elpi dev] Development accounts & private keys available at window.__ELPI_DEV__. Run `__ELPI_DEV__.logKeys()` in console to view all keys."
  );
}

