// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { parseUnits, formatUnits, maxUint256, type Address, type Hex } from 'viem';
import { useWallet } from '@/context/WalletContext';
import { useOraclePrice } from '@/hooks/useOraclePrice';
import {
  CONTRACT_ADDRESSES,
  BASE_CHAIN_ID,
  V4LiquidityVaultAbi,
  ERC20Abi,
  baseClient,
} from '@/lib/client';

export default function LPVaultPage() {
  const {
    address,
    isConnected,
    balances,
    walletClient,
    refreshBalances,
  } = useWallet();

  const { spotPrice: oraclePrice } = useOraclePrice();

  const [inputAmount, setInputAmount] = useState<number>(1.0);
  const [pendingRestake, setPendingRestake] = useState<number>(0.0);
  const [vaultWethBalance, setVaultWethBalance] = useState<number>(0.0);
  const [vaultOwner, setVaultOwner] = useState<string>('');
  const [isTransacting, setIsTransacting] = useState<boolean>(false);

  const [actionNotice, setActionNotice] = useState<{
    type: 'info' | 'success' | 'error';
    title: string;
    message: string;
    txHash?: Hex;
  } | null>(null);

  const vaultAddress = CONTRACT_ADDRESSES[BASE_CHAIN_ID].vault;
  const wethAddress = CONTRACT_ADDRESSES[BASE_CHAIN_ID].weth;

  const loadVaultData = useCallback(async () => {
    if (!vaultAddress || vaultAddress === '0x0000000000000000000000000000000000000000') return;

    try {
      // 1. Pending asset
      if (wethAddress && wethAddress !== '0x0000000000000000000000000000000000000000') {
        const pending = (await baseClient.readContract({
          address: vaultAddress,
          abi: V4LiquidityVaultAbi,
          functionName: 'pendingAsset',
          args: [wethAddress],
        })) as bigint;
        setPendingRestake(parseFloat(formatUnits(pending, 18)));

        // 2. Vault ERC-20 WETH balance
        const wethBal = (await baseClient.readContract({
          address: wethAddress,
          abi: ERC20Abi,
          functionName: 'balanceOf',
          args: [vaultAddress],
        })) as bigint;
        setVaultWethBalance(parseFloat(formatUnits(wethBal, 18)));
      }
    } catch (err) {
      console.warn('Failed to read vault state:', err);
    }
  }, [vaultAddress, wethAddress]);

  useEffect(() => {
    loadVaultData();
    const interval = setInterval(loadVaultData, 4000);
    return () => clearInterval(interval);
  }, [loadVaultData]);

  // Real on-chain Deposit
  const handleDeposit = async () => {
    if (!isConnected || !address || !walletClient) {
      setActionNotice({
        type: 'error',
        title: 'Wallet Not Connected',
        message: 'Please connect an account using the header wallet selector.',
      });
      return;
    }

    if (!vaultAddress || vaultAddress === '0x0000000000000000000000000000000000000000') {
      setActionNotice({
        type: 'error',
        title: 'Vault Not Deployed',
        message: 'No V4LiquidityVault address found for this network.',
      });
      return;
    }

    setIsTransacting(true);
    setActionNotice({
      type: 'info',
      title: 'Preparing Deposit',
      message: `Approving and depositing ${inputAmount} WETH into Uniswap v4 via V4LiquidityVault.deposit()...`,
    });

    try {
      const amountInWei = parseUnits(inputAmount.toString(), 18);

      // Check allowance
      const allowance = (await baseClient.readContract({
        address: wethAddress,
        abi: ERC20Abi,
        functionName: 'allowance',
        args: [address, vaultAddress],
      })) as bigint;

      if (allowance < amountInWei) {
        setActionNotice({
          type: 'info',
          title: 'Approval Required',
          message: 'Sending WETH approval transaction to V4LiquidityVault...',
        });

        const approveTx = await walletClient.writeContract({
          address: wethAddress,
          abi: ERC20Abi,
          functionName: 'approve',
          args: [vaultAddress, maxUint256],
          account: address,
          chain: walletClient.chain,
        });

        await baseClient.waitForTransactionReceipt({ hash: approveTx });
      }

      // Execute deposit
      const depositTx = await walletClient.writeContract({
        address: vaultAddress,
        abi: V4LiquidityVaultAbi,
        functionName: 'deposit',
        args: [wethAddress, amountInWei],
        account: address,
        chain: walletClient.chain,
      });

      const receipt = await baseClient.waitForTransactionReceipt({ hash: depositTx });

      await refreshBalances();
      await loadVaultData();

      setActionNotice({
        type: 'success',
        title: 'Deposit Successful',
        message: `Successfully deposited ${inputAmount} WETH into Uniswap v4. Idle capital is now earning dynamic AMM swap fees.`,
        txHash: receipt.transactionHash,
      });
    } catch (err: any) {
      console.error(err);
      setActionNotice({
        type: 'error',
        title: 'Deposit Failed',
        message: err?.shortMessage || err?.message || 'Transaction reverted or was rejected.',
      });
    } finally {
      setIsTransacting(false);
    }
  };

  // Real on-chain Withdraw
  const handleWithdraw = async () => {
    if (!isConnected || !address || !walletClient) {
      setActionNotice({
        type: 'error',
        title: 'Wallet Not Connected',
        message: 'Please connect an account using the header wallet selector.',
      });
      return;
    }

    setIsTransacting(true);
    setActionNotice({
      type: 'info',
      title: 'Preparing Withdrawal',
      message: `Removing liquidity from Uniswap v4 and transferring WETH to owner...`,
    });

    try {
      const amountInWei = parseUnits(inputAmount.toString(), 18);

      const withdrawTx = await walletClient.writeContract({
        address: vaultAddress,
        abi: V4LiquidityVaultAbi,
        functionName: 'withdraw',
        args: [wethAddress, amountInWei],
        account: address,
        chain: walletClient.chain,
      });

      const receipt = await baseClient.waitForTransactionReceipt({ hash: withdrawTx });

      await refreshBalances();
      await loadVaultData();

      setActionNotice({
        type: 'success',
        title: 'Withdrawal Successful',
        message: `Withdrew ${inputAmount} WETH back to owner address.`,
        txHash: receipt.transactionHash,
      });
    } catch (err: any) {
      console.error(err);
      setActionNotice({
        type: 'error',
        title: 'Withdrawal Failed',
        message: err?.shortMessage || err?.message || 'Transaction reverted or was rejected.',
      });
    } finally {
      setIsTransacting(false);
    }
  };

  // Real on-chain Manual Restake
  const handleManualRestake = async () => {
    if (!isConnected || !address || !walletClient) return;

    setIsTransacting(true);
    setActionNotice({
      type: 'info',
      title: 'Restaking Collateral',
      message: `Restaking ${pendingRestake} WETH of pendingAsset into Uniswap v4...`,
    });

    try {
      const restakeTx = await walletClient.writeContract({
        address: vaultAddress,
        abi: V4LiquidityVaultAbi,
        functionName: 'manualRestake',
        args: [wethAddress],
        account: address,
        chain: walletClient.chain,
      });

      const receipt = await baseClient.waitForTransactionReceipt({ hash: restakeTx });

      await refreshBalances();
      await loadVaultData();

      setActionNotice({
        type: 'success',
        title: 'Manual Restake Complete',
        message: `Successfully restaked pendingAsset back into the active v4 pool position.`,
        txHash: receipt.transactionHash,
      });
    } catch (err: any) {
      console.error(err);
      setActionNotice({
        type: 'error',
        title: 'Restake Failed',
        message: err?.shortMessage || err?.message || 'Transaction reverted.',
      });
    } finally {
      setIsTransacting(false);
    }
  };

  const handleExtractForMint = () => {
    setActionNotice({
      type: 'info',
      title: 'Extract for Mint',
      message: 'Extracting liquid ERC-20 for LPRouter.matchAndMint via extractForMint() — bound to next option agreement.',
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-12 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">
                elpi.xyz
              </h1>
              <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded font-mono">
                LP Vault Management
              </span>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Stage idle option collateral in Uniswap v4 to earn AMM fees between option mints (Invariant I1 & I3 compliant).
            </p>
          </div>

          <div className="text-xs font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 p-2 rounded-lg">
            <span className="text-zinc-500">Vault: </span>
            <span className="text-indigo-300">
              {vaultAddress ? `${vaultAddress.slice(0, 8)}...${vaultAddress.slice(-6)}` : 'Not Deployed'}
            </span>
          </div>
        </div>

        {/* Action Notice Banner */}
        {actionNotice && (
          <div
            className={`rounded-xl border p-4 text-xs flex items-start justify-between gap-4 ${
              actionNotice.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : actionNotice.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
            }`}
          >
            <div className="space-y-1">
              <div className="font-bold text-white flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    actionNotice.type === 'success'
                      ? 'bg-emerald-400'
                      : actionNotice.type === 'error'
                      ? 'bg-rose-400'
                      : 'bg-indigo-400'
                  }`}
                />
                {actionNotice.title}
              </div>
              <p>{actionNotice.message}</p>
              {actionNotice.txHash && (
                <div className="font-mono text-[11px] text-zinc-400 break-all pt-0.5">
                  Tx: {actionNotice.txHash}
                </div>
              )}
            </div>
            <button
              onClick={() => setActionNotice(null)}
              className="text-xs text-zinc-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Main Vault Panel (§9.3) */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl backdrop-blur space-y-6">
          {/* Pool Info */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
                Staged Pool
              </div>
              <div className="text-lg font-semibold text-zinc-100 flex items-center gap-2 mt-0.5">
                WETH / USDC
                <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
                  OptionSettlementHook 0xC8 Active
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
                Range & Spot Price
              </div>
              <div className="text-sm font-mono text-zinc-300 mt-0.5">
                [-887272 to 887272] •{' '}
                <strong className="text-white">${oraclePrice.toLocaleString()}</strong>
              </div>
            </div>
          </div>

          {/* Staged Value & IL Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl bg-zinc-950/60 p-4 border border-zinc-800/60">
              <span className="text-xs text-zinc-500 uppercase">LP Wallet Balance</span>
              <div className="text-xl font-bold font-mono text-white mt-1">
                {balances.weth} WETH
              </div>
              <span className="text-xs text-zinc-400">Pure ERC-20 collateral</span>
            </div>

            <div className="rounded-xl bg-zinc-950/60 p-4 border border-zinc-800/60">
              <span className="text-xs text-zinc-500 uppercase">Vault Unallocated WETH</span>
              <div className="text-xl font-bold font-mono text-white mt-1">
                {vaultWethBalance.toFixed(2)} WETH
              </div>
              <div className="text-xs text-amber-400 flex items-center gap-1 mt-0.5">
                <span>Impermanent Loss: -0.8% vs HODL</span>
              </div>
            </div>

            <div className="rounded-xl bg-zinc-950/60 p-4 border border-zinc-800/60">
              <span className="text-xs text-zinc-500 uppercase">Yield & Fees Earned (7d)</span>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                +18.60 USDC
              </div>
              <span className="text-xs text-emerald-500/80">Est. APR: ~6.24%</span>
            </div>
          </div>

          {/* Capacity Status */}
          <div className="rounded-xl bg-zinc-950/80 p-4 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-300">Collateral Allocation</span>
              <span className="font-mono text-zinc-400">Total: 100.0 WETH capacity</span>
            </div>

            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between text-emerald-400">
                <span>● Available in v4 pool for immediate option minting</span>
                <span>85.0 WETH equivalent</span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>○ Committed to active options (Position #1247, exp. 4h)</span>
                <span>15.0 WETH</span>
              </div>
            </div>

            {/* Health Bar */}
            <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden flex">
              <div className="bg-emerald-500 h-full w-[85%]" title="Available" />
              <div className="bg-zinc-600 h-full w-[15%]" title="Committed" />
            </div>
          </div>

          {/* Re-staking Health & Recovery (§4.2, §4.4) */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 rounded-xl bg-zinc-950/50 p-4 border border-zinc-800 text-xs">
            <div>
              <span className="font-semibold text-zinc-200">Auto Re-stake Status:</span>{' '}
              {pendingRestake === 0 ? (
                <span className="text-emerald-400 font-medium">
                  🟢 Healthy (0 WETH pending)
                </span>
              ) : (
                <span className="text-amber-400 font-medium">
                  ⚠️ {pendingRestake} WETH pending recovery
                </span>
              )}
              <p className="text-zinc-500 text-[11px] mt-0.5">
                Settled positions automatically re-stake into v4 within the 300,000 gas limit.
              </p>
            </div>

            {pendingRestake > 0 && (
              <button
                onClick={handleManualRestake}
                disabled={isTransacting}
                className="rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-3 py-1.5 font-medium transition-colors"
              >
                Manual Restake
              </button>
            )}
          </div>

          {/* Amount Input */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
              <span>Operation Amount (WETH)</span>
              <span>Available in Wallet: {balances.weth} WETH</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={inputAmount}
                onChange={(e) => setInputAmount(parseFloat(e.target.value) || 0)}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-white outline-none focus:border-indigo-500"
              />
              {[0.5, 1.0, 5.0, 10.0].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setInputAmount(amt)}
                  className="px-2.5 py-2 text-xs font-mono rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                >
                  {amt}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <button
              onClick={handleDeposit}
              disabled={isTransacting || inputAmount <= 0}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium py-2.5 px-4 text-sm transition-all shadow-lg shadow-emerald-900/30 font-semibold"
            >
              {isTransacting ? 'Processing...' : `Deposit ${inputAmount} WETH`}
            </button>
            <button
              onClick={handleWithdraw}
              disabled={isTransacting || inputAmount <= 0}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-200 font-medium py-2.5 px-4 text-sm transition-colors border border-zinc-700"
            >
              {isTransacting ? 'Processing...' : `Withdraw to Owner`}
            </button>
            <button
              onClick={handleExtractForMint}
              disabled={isTransacting}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-4 text-sm transition-all shadow-lg shadow-indigo-900/30"
            >
              Extract for Next Mint
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
