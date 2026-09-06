// SPDX-License-Identifier: MIT
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  type Address,
  type WalletClient,
  type PublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import {
  baseClient,
  CONTRACT_ADDRESSES,
  BASE_CHAIN_ID,
  ERC20Abi,
} from '@/lib/client';

export type WalletPersona = 'DEPLOYER' | 'LP' | 'TAKER' | 'TAKER2' | 'INJECTED';

export interface WalletBalances {
  eth: string;
  weth: string;
  usdc: string;
  rawEth: bigint;
  rawWeth: bigint;
  rawUsdc: bigint;
}

interface WalletContextType {
  address: Address | null;
  persona: WalletPersona | null;
  isConnected: boolean;
  isConnecting: boolean;
  chainId: number;
  balances: WalletBalances;
  walletClient: any;
  publicClient: any;
  connect: (mode: WalletPersona) => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
}

const DEVNET_ACCOUNTS = {
  DEPLOYER: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
    label: 'Deployer / Governance',
  },
  LP: {
    address: '0xf85B008086EA4f59f17aE9E0665962a1e45c7855' as Address,
    key: '0xb9912f8133b56bb35ebf2baf7a62faa21e0c30f865c4e9abc599aab8bcb7e7fa' as `0x${string}`,
    label: 'Alice (elpi1 / LP Vault)',
  },
  TAKER: {
    address: '0x61755DF0a398ee315bcC077d99B5eaC7c73ca813' as Address,
    key: '0xfdc6e5b4548767f71e2b7b835529510d49436a578dc5b57ede07a2be0866c0b4' as `0x${string}`,
    label: 'Bob (elpi2 / Taker 1)',
  },
  TAKER2: {
    address: '0xEB1b98c730a0fA3F3419cb201D343D509767865b' as Address,
    key: '0x4f6640b8640a7981a1c1f13b600f848c860f51a0e33fd445713d21ced84628c5' as `0x${string}`,
    label: 'Charlie (elpi3 / Taker 2)',
  },
};

const initialBalances: WalletBalances = {
  eth: '0.0000',
  weth: '0.0000',
  usdc: '0.00',
  rawEth: 0n,
  rawWeth: 0n,
  rawUsdc: 0n,
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<Address | null>(null);
  const [persona, setPersona] = useState<WalletPersona | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [balances, setBalances] = useState<WalletBalances>(initialBalances);

  const fetchBalances = useCallback(async (targetAddress: Address) => {
    try {
      const contracts = CONTRACT_ADDRESSES[BASE_CHAIN_ID];
      const ethBal = await baseClient.getBalance({ address: targetAddress });

      let wethBal = 0n;
      let usdcBal = 0n;

      if (contracts.weth && contracts.weth !== '0x0000000000000000000000000000000000000000') {
        try {
          wethBal = (await baseClient.readContract({
            address: contracts.weth,
            abi: ERC20Abi,
            functionName: 'balanceOf',
            args: [targetAddress],
          })) as bigint;
        } catch {}
      }

      if (contracts.usdc && contracts.usdc !== '0x0000000000000000000000000000000000000000') {
        try {
          usdcBal = (await baseClient.readContract({
            address: contracts.usdc,
            abi: ERC20Abi,
            functionName: 'balanceOf',
            args: [targetAddress],
          })) as bigint;
        } catch {}
      }

      setBalances({
        eth: parseFloat(formatEther(ethBal)).toFixed(4),
        weth: parseFloat(formatUnits(wethBal, 18)).toFixed(4),
        usdc: parseFloat(formatUnits(usdcBal, 6)).toFixed(2),
        rawEth: ethBal,
        rawWeth: wethBal,
        rawUsdc: usdcBal,
      });
    } catch (err) {
      console.warn('Failed to load wallet balances:', err);
    }
  }, []);

  const connect = useCallback(async (mode: WalletPersona) => {
    setIsConnecting(true);
    try {
      if (mode === 'INJECTED') {
        if (typeof window === 'undefined' || !(window as any).ethereum) {
          alert('No injected Ethereum wallet found (MetaMask / Rabby / Coinbase).');
          setIsConnecting(false);
          return;
        }
        const eth = (window as any).ethereum;
        const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          const acc = accounts[0] as Address;
          const client = createWalletClient({
            account: acc,
            chain: base,
            transport: custom(eth),
          });
          setAddress(acc);
          setPersona('INJECTED');
          setWalletClient(client);
          await fetchBalances(acc);
        }
      } else {
        const config = DEVNET_ACCOUNTS[mode];
        const account = privateKeyToAccount(config.key);
        const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'http://127.0.0.1:8545';
        const client = createWalletClient({
          account,
          chain: base,
          transport: http(rpcUrl),
        });
        setAddress(account.address);
        setPersona(mode);
        setWalletClient(client);
        await fetchBalances(account.address);
      }
    } catch (err) {
      console.error('Wallet connection failed:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [fetchBalances]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setPersona(null);
    setWalletClient(null);
    setBalances(initialBalances);
  }, []);

  const refreshBalances = useCallback(async () => {
    if (address) {
      await fetchBalances(address);
    }
  }, [address, fetchBalances]);

  // Auto-connect to LP Persona by default on local development if no wallet connected
  useEffect(() => {
    if (!address && typeof window !== 'undefined') {
      const savedPersona = localStorage.getItem('elpi_persona') as WalletPersona | null;
      if (savedPersona && (savedPersona === 'DEPLOYER' || savedPersona === 'LP' || savedPersona === 'TAKER' || savedPersona === 'TAKER2')) {
        connect(savedPersona);
      } else if (process.env.NEXT_PUBLIC_BASE_RPC_URL?.includes('127.0.0.1')) {
        // Default to LP persona for instant dev experience
        connect('LP');
      }
    }
  }, [address, connect]);

  useEffect(() => {
    if (persona && persona !== 'INJECTED') {
      localStorage.setItem('elpi_persona', persona);
    }
  }, [persona]);

  return (
    <WalletContext.Provider
      value={{
        address,
        persona,
        isConnected: !!address,
        isConnecting,
        chainId: BASE_CHAIN_ID,
        balances,
        walletClient,
        publicClient: baseClient,
        connect,
        disconnect,
        refreshBalances,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
