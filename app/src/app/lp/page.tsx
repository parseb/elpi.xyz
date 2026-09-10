"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { formatUnits, maxUint256, parseUnits } from "viem";
import {
  useConnection,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { addresses } from "@/config/addresses";
import {
  assetDecimals,
  assetDisplaySymbol,
  assetSymbol,
  explorerAddressUrl,
  shortenAddress,
} from "@/lib/assetLabels";
import { MockERC20Abi } from "@/generated/abis/MockERC20";
import { LPRouterAbi } from "@/generated/abis/LPRouter";
import { V4LiquidityVaultAbi } from "@/generated/abis/V4LiquidityVault";
import {
  backerQuoteDomain,
  backerQuoteTypes,
  ZERO_BYTES32 as ZERO_BYTES32_QUOTE,
  type SignedBackerQuote,
} from "@/lib/backerQuote";
import type { OptionTypeSupport } from "@/lib/liquidityProfile";
import {
  exportQuoteJson,
  listQuotes,
  markQuoteHistorical,
  removeQuote,
  saveQuote,
} from "@/lib/quoteStore";
import { formatDuration } from "@/lib/charts";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Field,
  InfoTooltip,
  PageHeader,
  Tooltip,
  inputClass,
  label as labelClass,
} from "@/components/ui";
import { ConnectButton } from "@/components/ConnectButton";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FilterIcon,
  RefreshIcon,
  TrashIcon,
} from "@/components/icons";
import { getCounterparty } from "@/lib/counterparties";

const COLLATERAL_CHOICES = [
  addresses.collateralAsset,
  addresses.wbtcAsset,
] as const;

const CONDITIONS = [
  {
    address: addresses.expiryCondition,
    label: "ExpiryCondition: auto-settles to LP upon expiration (Standard)",
    tooltip: "Option expires after duration and unexercised collateral auto-restakes into the Uniswap v4 pool.",
  },
  {
    address: addresses.takerProfitCondition,
    label: "TakerProfitCondition: auto-settles to taker when profitable",
    tooltip: "Taker can exercise early if current oracle price produces positive payoff via Uniswap v4 flash swap.",
  },
] as const;

export default function ProvidePage() {
  const { address, isConnected } = useConnection();
  const publicClient = usePublicClient();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();

  // Contract Writes
  const approveToken = useWriteContract();
  const depositVault = useWriteContract();
  const withdrawVault = useWriteContract();
  const manualRestakeVault = useWriteContract();
  const withdrawRouter = useWriteContract();

  // Selection & UI State
  const [selectedAsset, setSelectedAsset] = useState<Address>(addresses.collateralAsset);
  const [stageAmount, setStageAmount] = useState("5.0");
  const [stageActionLoading, setStageActionLoading] = useState(false);
  const [stageSuccessMsg, setStageSuccessMsg] = useState<string | null>(null);

  // Quoting Mode: Uniswap v4 Vault (Dual Yield) vs Direct EOA
  const [quotingMode, setQuotingMode] = useState<"v4Vault" | "directWallet">("v4Vault");

  // Options Quote Configuration
  const [units, setUnits] = useState("1000"); // 10 WETH
  const [pricePerUnitPerHour, setPricePerUnitPerHour] = useState("0.10");
  const [minHours, setMinHours] = useState("1");
  const [maxHours, setMaxHours] = useState("720");
  const [supportsOptionType, setSupportsOptionType] = useState<OptionTypeSupport>(2);

  // Advanced Terms
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [conditionAddress, setConditionAddress] = useState(addresses.expiryCondition);
  const [maxPriceAge, setMaxPriceAge] = useState("3600");
  const [slippageBps, setSlippageBps] = useState("100");

  // Offers Store
  const [quotes, setQuotes] = useState<SignedBackerQuote[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<"all" | "active" | "historical">("active");
  const [quoteOwnershipFilter, setQuoteOwnershipFilter] = useState<"all" | "mine">("all");

  const [deleteConfirmHash, setDeleteConfirmHash] = useState<{ hash: string; hard: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Load quotes from store
  useEffect(() => {
    setQuotesLoading(true);
    listQuotes({ status: quoteStatusFilter === "all" ? "all" : quoteStatusFilter })
      .then((data) => setQuotes(data))
      .finally(() => setQuotesLoading(false));
  }, [refreshTick, quoteStatusFilter]);

  const settlementDecimals = assetDecimals(addresses.settlementAsset);
  const collateralSymbol = assetSymbol(selectedAsset);
  const collateralDecimals = assetDecimals(selectedAsset);

  // ─── Uniswap v4 Vault On-Chain Reads ──────────────────────────────────────────
  const vaultReads = useReadContracts({
    contracts: [
      // 0: Vault WETH balance (active collateral staged in Uniswap v4)
      {
        address: selectedAsset,
        abi: MockERC20Abi,
        functionName: "balanceOf",
        args: [addresses.v4LiquidityVault],
      },
      // 1: User WETH wallet balance
      {
        address: selectedAsset,
        abi: MockERC20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      // 2: User allowance for V4LiquidityVault
      {
        address: selectedAsset,
        abi: MockERC20Abi,
        functionName: "allowance",
        args: address ? [address, addresses.v4LiquidityVault] : undefined,
      },
      // 3: User allowance for LPRouter (for direct EOA quoting)
      {
        address: selectedAsset,
        abi: MockERC20Abi,
        functionName: "allowance",
        args: address ? [address, addresses.lpRouter] : undefined,
      },
      // 4: Vault pendingAsset (residual settled collateral awaiting restake)
      {
        address: addresses.v4LiquidityVault,
        abi: V4LiquidityVaultAbi,
        functionName: "pendingAsset",
        args: [selectedAsset],
      },
      // 5: Vault owner
      {
        address: addresses.v4LiquidityVault,
        abi: V4LiquidityVaultAbi,
        functionName: "owner",
      },
      // 6: Vault lower tick
      {
        address: addresses.v4LiquidityVault,
        abi: V4LiquidityVaultAbi,
        functionName: "tickLower",
      },
      // 7: Vault upper tick
      {
        address: addresses.v4LiquidityVault,
        abi: V4LiquidityVaultAbi,
        functionName: "tickUpper",
      },
    ],
    query: { staleTime: 8_000 },
  });

  const vaultBalance = (vaultReads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const userBalance = (vaultReads.data?.[1]?.result as bigint | undefined) ?? 0n;
  const vaultAllowance = (vaultReads.data?.[2]?.result as bigint | undefined) ?? 0n;
  const routerAllowance = (vaultReads.data?.[3]?.result as bigint | undefined) ?? 0n;
  const pendingAsset = (vaultReads.data?.[4]?.result as bigint | undefined) ?? 0n;
  const vaultOwner = (vaultReads.data?.[5]?.result as Address | undefined) ?? "0x0000000000000000000000000000000000000000";
  const tickLower = (vaultReads.data?.[6]?.result as number | undefined) ?? 600;
  const tickUpper = (vaultReads.data?.[7]?.result as number | undefined) ?? 1200;

  // Check claimable returns from LPRouter
  const claimableReads = useReadContracts({
    contracts: [
      {
        address: addresses.lpRouter,
        abi: LPRouterAbi,
        functionName: "claimable",
        args: address ? [address, addresses.settlementAsset] : undefined,
      },
      {
        address: addresses.lpRouter,
        abi: LPRouterAbi,
        functionName: "claimable",
        args: address ? [address, addresses.collateralAsset] : undefined,
      },
      {
        address: addresses.lpRouter,
        abi: LPRouterAbi,
        functionName: "claimable",
        args: address ? [address, addresses.wbtcAsset] : undefined,
      },
    ],
    query: { enabled: !!address, staleTime: 10_000 },
  });

  const claimableSettlement = claimableReads.data?.[0]?.result as bigint | undefined;
  const claimableWeth = claimableReads.data?.[1]?.result as bigint | undefined;
  const claimableWbtc = claimableReads.data?.[2]?.result as bigint | undefined;

  const hasClaimable = Boolean(
    (claimableSettlement && claimableSettlement > 0n) ||
      (claimableWeth && claimableWeth > 0n) ||
      (claimableWbtc && claimableWbtc > 0n)
  );

  const unitsNum = Math.max(0, Number(units) || 0);
  const collateralAmount = (unitsNum * 0.01).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const priceNum = Math.max(0, Number(pricePerUnitPerHour) || 0);
  const dailyEarningPerUnit = (priceNum * 24).toFixed(2);

  // Staging input conversion
  const parsedStageAmount = useMemo(() => {
    try {
      const val = parseFloat(stageAmount);
      if (isNaN(val) || val <= 0) return 0n;
      return parseUnits(stageAmount, collateralDecimals);
    } catch {
      return 0n;
    }
  }, [stageAmount, collateralDecimals]);

  const hasVaultAllowance = vaultAllowance >= parsedStageAmount && vaultAllowance > 0n;
  const hasRouterAllowance = routerAllowance > 0n;

  // ─── Actions: Approve & Stage Collateral into Uniswap v4 Vault ───────────────
  async function handleApproveVault() {
    if (!address) return;
    setError(null);
    setStageActionLoading(true);
    try {
      approveToken.reset?.();
      const hash = await approveToken.writeContractAsync({
        address: selectedAsset,
        abi: MockERC20Abi,
        functionName: "approve",
        args: [addresses.v4LiquidityVault, maxUint256],
      });
      if (publicClient && hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await vaultReads.refetch();
      setStageSuccessMsg(`Approved ${collateralSymbol} for Uniswap v4 Liquidity Vault!`);
      setTimeout(() => setStageSuccessMsg(null), 5000);
    } catch (e) {
      approveToken.reset?.();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStageActionLoading(false);
    }
  }

  async function handleDepositVault() {
    if (!address || parsedStageAmount <= 0n) return;
    setError(null);
    setStageActionLoading(true);
    try {
      depositVault.reset?.();
      const hash = await depositVault.writeContractAsync({
        address: addresses.v4LiquidityVault,
        abi: V4LiquidityVaultAbi,
        functionName: "deposit",
        args: [selectedAsset, parsedStageAmount],
      });
      if (publicClient && hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await vaultReads.refetch();
      setStageSuccessMsg(
        `Successfully staged ${stageAmount} ${collateralSymbol} into Uniswap v4 pool ticks [${tickLower}, ${tickUpper}]!`,
      );
      setTimeout(() => setStageSuccessMsg(null), 7000);
    } catch (e) {
      depositVault.reset?.();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStageActionLoading(false);
    }
  }

  async function handleWithdrawVault() {
    if (!address || parsedStageAmount <= 0n) return;
    setError(null);
    setStageActionLoading(true);
    try {
      withdrawVault.reset?.();
      const hash = await withdrawVault.writeContractAsync({
        address: addresses.v4LiquidityVault,
        abi: V4LiquidityVaultAbi,
        functionName: "withdraw",
        args: [selectedAsset, parsedStageAmount],
      });
      if (publicClient && hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await vaultReads.refetch();
      setStageSuccessMsg(`Successfully withdrew ${stageAmount} ${collateralSymbol} from Uniswap v4 Vault!`);
      setTimeout(() => setStageSuccessMsg(null), 7000);
    } catch (e) {
      withdrawVault.reset?.();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStageActionLoading(false);
    }
  }

  async function handleManualRestake() {
    if (!address || pendingAsset <= 0n) return;
    setError(null);
    setStageActionLoading(true);
    try {
      manualRestakeVault.reset?.();
      const hash = await manualRestakeVault.writeContractAsync({
        address: addresses.v4LiquidityVault,
        abi: V4LiquidityVaultAbi,
        functionName: "manualRestake",
        args: [selectedAsset],
      });
      if (publicClient && hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await vaultReads.refetch();
      setStageSuccessMsg(`Restaked residual ${collateralSymbol} back into Uniswap v4 pool!`);
      setTimeout(() => setStageSuccessMsg(null), 5000);
    } catch (e) {
      manualRestakeVault.reset?.();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStageActionLoading(false);
    }
  }

  // ─── Action: Cryptographic Options Quote Signing ─────────────────────────────
  const handleSign = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      const isWbtc = selectedAsset === addresses.wbtcAsset;
      const oracle = isWbtc ? addresses.btcPriceOracle : addresses.priceOracle;
      const finalMaxPriceAge = Number(maxPriceAge);

      // Backer selection: Uniswap v4 Vault (Contract Backer) vs Direct Wallet EOA
      const isVaultBacked = quotingMode === "v4Vault";
      const targetBacker = isVaultBacked ? addresses.v4LiquidityVault : address;
      const targetVenue = addresses.venueAdapter; // Canonical Uniswap v4 Venue Adapter
      const targetRouteId = addresses.routeId; // Canonical Uniswap v4 Route

      const message = {
        backer: targetBacker,
        collateralAsset: selectedAsset,
        settlementAsset: addresses.settlementAsset,
        minHours: Number(minHours),
        maxHours: Number(maxHours),
        maxUnits: BigInt(units),
        pricePerUnitPerHour: parseUnits(pricePerUnitPerHour, settlementDecimals),
        supportsOptionType,
        unitScalarNum: 1n,
        unitScalarDen: 100n,
        oracle,
        venue: targetVenue,
        arbiter: addresses.conditionArbiter,
        condition: conditionAddress,
        routeId: targetRouteId,
        maxPriceAge: finalMaxPriceAge,
        slippageBps: Number(slippageBps),
        nonce: BigInt(Date.now()),
      };

      const signature = await signTypedDataAsync({
        domain: backerQuoteDomain,
        types: backerQuoteTypes,
        primaryType: "BackerQuote",
        message,
      });

      const signed: SignedBackerQuote = { ...message, signature };
      await saveQuote(signed);
      setRefreshTick((n) => n + 1);
      setLastExport(exportQuoteJson(signed));
      setStageSuccessMsg(
        isVaultBacked
          ? "Options offer published! Backed by Uniswap v4 Liquidity Vault via ERC-1271 signatures."
          : "Direct EOA options offer published to order book.",
      );
      setTimeout(() => setStageSuccessMsg(null), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [
    address,
    selectedAsset,
    quotingMode,
    maxPriceAge,
    minHours,
    maxHours,
    units,
    pricePerUnitPerHour,
    settlementDecimals,
    supportsOptionType,
    conditionAddress,
    slippageBps,
    signTypedDataAsync,
  ]);

  const handleDeactivateQuote = async (quote: SignedBackerQuote) => {
    const hash = `${quote.backer}-${quote.nonce}`;
    await markQuoteHistorical(hash);
    setRefreshTick((n) => n + 1);
  };

  const handleDeleteQuote = async (quote: SignedBackerQuote, hard = true) => {
    const hash = `${quote.backer}-${quote.nonce}`;
    await removeQuote(hash, hard);
    setRefreshTick((n) => n + 1);
    setDeleteConfirmHash(null);
  };

  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      if (quoteOwnershipFilter === "mine" && address) {
        if (q.backer.toLowerCase() !== address.toLowerCase() && q.backer.toLowerCase() !== addresses.v4LiquidityVault.toLowerCase()) {
          return false;
        }
      }
      return true;
    });
  }, [quotes, quoteOwnershipFilter, address]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Provide Liquidity"
        description="Deposit collateral into the Uniswap v4 Liquidity Vault to earn AMM trading fees while uncommitted. Issue options offers backed by staged liquidity with atomic extraction and automatic re-staking."
        tooltip="LPs stage collateral in the Uniswap v4 Liquidity Vault to earn dual yield: continuous AMM swap fees from DEX volume, plus streaming option premiums when matched."
        actions={
          <div role="tablist" aria-label="Asset Selection" className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1">
            {COLLATERAL_CHOICES.map((a) => {
              const active = selectedAsset === a;
              const sym = assetDisplaySymbol(a);
              return (
                <Tooltip key={a} content={`Provide liquidity denominated in ${sym}`}>
                  <button
                    role="tab"
                    aria-selected={active}
                    type="button"
                    onClick={() => setSelectedAsset(a)}
                    className={`min-h-[32px] rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
                      active
                        ? "bg-[var(--base-blue)] text-white shadow-xs"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {sym}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      {stageSuccessMsg && (
        <div className="rounded-xl border border-[var(--emerald-border)] bg-[var(--emerald-bg)] p-3.5 text-xs text-[var(--emerald-text)] font-semibold flex items-center gap-2">
          <CheckIcon size={14} />
          <span>{stageSuccessMsg}</span>
        </div>
      )}

      {!isConnected && (
        <EmptyState icon={<EmptyState.WalletIcon />} title="No Wallet Connected" action={<ConnectButton />}>
          Connect wallet to stage liquidity into the Uniswap v4 Vault and issue options offers.
        </EmptyState>
      )}

      {isConnected && (
        <div className="flex flex-col gap-5">
          {/* Claimable Returns Banner */}
          {hasClaimable && (
            <Card className="border-[var(--emerald-border)] bg-[var(--emerald-bg)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[var(--emerald-text)]">Claimable Yield &amp; Settlement Returns</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Accrued premiums and returned collateral from settled positions are ready to withdraw.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs font-semibold text-[var(--foreground)]">
                    {claimableSettlement && claimableSettlement > 0n && (
                      <span>${formatUnits(claimableSettlement, settlementDecimals)} USDC</span>
                    )}
                    {claimableWeth && claimableWeth > 0n && (
                      <span>{formatUnits(claimableWeth, 18)} WETH</span>
                    )}
                    {claimableWbtc && claimableWbtc > 0n && (
                      <span>{formatUnits(claimableWbtc, 8)} WBTC</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {claimableSettlement && claimableSettlement > 0n && (
                    <Button
                      variant="primary"
                      className="text-xs py-1.5"
                      onClick={() =>
                        withdrawRouter.writeContract({
                          address: addresses.lpRouter,
                          abi: LPRouterAbi,
                          functionName: "withdraw",
                          args: [addresses.settlementAsset],
                        })
                      }
                      disabled={withdrawRouter.isPending}
                    >
                      Withdraw USDC
                    </Button>
                  )}
                  {claimableWeth && claimableWeth > 0n && (
                    <Button
                      variant="secondary"
                      className="text-xs py-1.5"
                      onClick={() =>
                        withdrawRouter.writeContract({
                          address: addresses.lpRouter,
                          abi: LPRouterAbi,
                          functionName: "withdraw",
                          args: [addresses.collateralAsset],
                        })
                      }
                      disabled={withdrawRouter.isPending}
                    >
                      Withdraw WETH
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* ─── CARD 1: UNISWAP V4 LIQUIDITY VAULT STAGING ──────────────────────── */}
          <Card className="flex flex-col gap-4 p-5 border-[var(--purple-border,rgba(168,85,247,0.3))] bg-[var(--card-bg)] shadow-sm">
            {/* Vault Header with Live Links */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-[#c084fc] animate-pulse" />
                <h2 className="text-sm font-bold text-[var(--foreground)]">
                  Uniswap v4 Collateral Staging
                </h2>
                <Badge tone="purple">v4 Staged LP</Badge>
              </div>

              {/* Verified Links to BaseScan & Contracts */}
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                <a
                  href={explorerAddressUrl(addresses.v4LiquidityVault)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[var(--base-blue-light)] hover:underline"
                  title="View V4LiquidityVault contract on BaseScan"
                >
                  <span>Vault: {shortenAddress(addresses.v4LiquidityVault)}</span>
                  <span className="text-[10px]">↗</span>
                </a>
                <span className="text-[var(--border)]">|</span>
                <a
                  href={explorerAddressUrl(addresses.poolManager)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--foreground)]"
                  title="View Uniswap v4 PoolManager contract on BaseScan"
                >
                  <span>PoolManager: {shortenAddress(addresses.poolManager)}</span>
                  <span className="text-[10px]">↗</span>
                </a>
              </div>
            </div>

            {/* Uniswap Pool Metadata Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-2 text-xs border border-[var(--border)]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--foreground)]">Pool Key:</span>
                <span className="font-mono text-[var(--base-blue-light)]">{collateralSymbol} / USDC</span>
                <span className="text-[var(--text-muted)]">·</span>
                <span className="text-[var(--text-muted)]">Fee: 0.30% (3,000)</span>
                <span className="text-[var(--text-muted)]">·</span>
                <span className="text-[var(--text-muted)]">Ticks: [{tickLower}, {tickUpper}]</span>
              </div>
              <div className="text-[var(--text-muted)] font-mono text-[11px]">
                Route: {shortenAddress(addresses.routeId)}
              </div>
            </div>

            {/* Live Balances Grid (3 Stats) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--purple-border,rgba(168,85,247,0.3))] bg-[rgba(168,85,247,0.06)] p-3">
                <div className="text-[11px] font-bold text-[#c084fc] flex items-center gap-1">
                  <span>Staged in Uniswap v4</span>
                  <InfoTooltip content="Collateral currently deposited into the Uniswap v4 pool ticks [600, 1200] earning AMM trading fees." size={12} />
                </div>
                <div className="mt-1 font-mono text-base font-bold text-[var(--foreground)]">
                  {formatUnits(vaultBalance, collateralDecimals)} {collateralSymbol}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  Earning continuous AMM fees
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <div className="text-[11px] font-bold text-[var(--text-muted)] flex items-center gap-1">
                  <span>Pending Auto-Restake</span>
                  <InfoTooltip content="Residual collateral returned from settled or expired options awaiting restake into the v4 pool." size={12} />
                </div>
                <div className="mt-1 font-mono text-base font-bold text-[var(--foreground)] flex items-center justify-between">
                  <span>{formatUnits(pendingAsset, collateralDecimals)} {collateralSymbol}</span>
                  {pendingAsset > 0n && (
                    <button
                      type="button"
                      onClick={handleManualRestake}
                      disabled={stageActionLoading}
                      className="rounded bg-[var(--base-blue)] px-2 py-0.5 text-[10px] font-bold text-white hover:bg-[var(--base-blue-hover)] cursor-pointer"
                    >
                      Restake
                    </button>
                  )}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  Settled residual balance
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <div className="text-[11px] font-bold text-[var(--text-muted)] flex items-center gap-1">
                  <span>Wallet Available</span>
                  <InfoTooltip content="Unstaged balance in your connected wallet available to deposit." size={12} />
                </div>
                <div className="mt-1 font-mono text-base font-bold text-[var(--foreground)]">
                  {formatUnits(userBalance, collateralDecimals)} {collateralSymbol}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  Available to stage
                </div>
              </div>
            </div>

            {/* Interactive Staging Controls */}
            <div className="flex flex-col gap-2 rounded-xl bg-[var(--surface)] p-3.5 border border-[var(--border)]">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-[var(--foreground)]">
                  Stage / Withdraw Collateral Amount
                </label>
                <div className="flex items-center gap-1 font-mono">
                  <button
                    type="button"
                    onClick={() => setStageAmount((Number(formatUnits(userBalance, collateralDecimals)) * 0.25).toFixed(2))}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--foreground)] border border-[var(--border)] cursor-pointer"
                  >
                    25%
                  </button>
                  <button
                    type="button"
                    onClick={() => setStageAmount((Number(formatUnits(userBalance, collateralDecimals)) * 0.5).toFixed(2))}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--foreground)] border border-[var(--border)] cursor-pointer"
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    onClick={() => setStageAmount(formatUnits(userBalance, collateralDecimals))}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] font-bold text-[var(--base-blue-light)] border border-[var(--base-blue-muted)] cursor-pointer"
                  >
                    Max
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2">
                <div className="relative flex-1 w-full">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={stageAmount}
                    onChange={(e) => setStageAmount(e.target.value)}
                    placeholder="0.0"
                    className={`${inputClass} font-mono font-bold pr-16`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)]">
                    {collateralSymbol}
                  </span>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {!hasVaultAllowance ? (
                    <Button
                      variant="secondary"
                      className="flex-1 sm:flex-none text-xs whitespace-nowrap"
                      disabled={stageActionLoading || parsedStageAmount <= 0n}
                      onClick={handleApproveVault}
                    >
                      {stageActionLoading ? "Approving..." : `Approve ${collateralSymbol} for Vault`}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      className="flex-1 sm:flex-none text-xs whitespace-nowrap"
                      disabled={stageActionLoading || parsedStageAmount <= 0n || userBalance < parsedStageAmount}
                      onClick={handleDepositVault}
                    >
                      {stageActionLoading ? "Staging..." : `Deposit & Stage in Uniswap v4`}
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    className="text-xs whitespace-nowrap"
                    disabled={stageActionLoading || parsedStageAmount <= 0n || vaultBalance < parsedStageAmount}
                    onClick={handleWithdrawVault}
                  >
                    Withdraw
                  </Button>
                </div>
              </div>
            </div>

            {/* Architecture Explainer Callout */}
            <div className="rounded-lg border border-[var(--base-blue-muted)] bg-[var(--base-blue-faint)] p-3 text-xs text-[var(--text-muted)] leading-relaxed">
              <strong className="text-[var(--foreground)]">Dual-Yield Lifecycle:</strong> Deposited {collateralSymbol} is staked into Uniswap v4 ticks [600, 1200] where it earns AMM trading fees while uncommitted. When a trader takes an option, the required collateral is extracted atomically in 1 transaction into an isolated position account. Unexercised collateral automatically re-stakes back into Uniswap v4 upon settlement.
            </div>
          </Card>

          {/* ─── CARD 2: OPTIONS QUOTING FORM (DUAL YIELD TERMS) ────────────────── */}
          <Card className="flex flex-col gap-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--foreground)]">
                  Issue Options Backed by Uniswap v4 Vault
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Sign cryptographic EIP-712 quotes backed by your staged Uniswap v4 collateral. Verified on-chain via ERC-1271.
                </p>
              </div>

              {/* Quoting Mode Switch */}
              <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setQuotingMode("v4Vault")}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                    quotingMode === "v4Vault"
                      ? "bg-[var(--base-blue)] text-white shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  Uniswap v4 Vault Backed
                </button>
                <button
                  type="button"
                  onClick={() => setQuotingMode("directWallet")}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                    quotingMode === "directWallet"
                      ? "bg-[var(--surface-overlay)] text-[var(--foreground)] font-extrabold"
                      : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  Direct Wallet (Solo)
                </button>
              </div>
            </div>

            {/* Standing Router Approval Notice (only if direct wallet mode is chosen) */}
            {quotingMode === "directWallet" && !hasRouterAllowance && (
              <div className="rounded-xl border border-[var(--amber-border)] bg-[var(--amber-bg)] p-3.5 text-xs text-[var(--amber-text)] flex items-center justify-between gap-3">
                <div>
                  <strong>Standing Approval Required for Solo EOA:</strong> Grant the LP Router an allowance so taker orders can pull collateral from your wallet.
                </div>
                <Button
                  variant="secondary"
                  className="text-xs py-1"
                  onClick={() =>
                    approveToken.writeContract({
                      address: selectedAsset,
                      abi: MockERC20Abi,
                      functionName: "approve",
                      args: [addresses.lpRouter, maxUint256],
                    })
                  }
                  disabled={approveToken.isPending}
                >
                  Approve {collateralSymbol}
                </Button>
              </div>
            )}

            {/* Capacity Slider */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-bold text-[var(--foreground)]">Offer Capacity (Units)</label>
                  <InfoTooltip content="100 units represents 1.0 underlying collateral asset. Max units your offer can be matched for." size={12} />
                </div>
                <span className="font-mono text-xs font-semibold text-[var(--base-blue-light)]">
                  {collateralAmount} {collateralSymbol}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="10"
                  max="10000"
                  step="10"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  className="h-2 flex-1 cursor-pointer accent-[var(--base-blue)]"
                />
                <input
                  type="number"
                  min="1"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 font-mono text-xs font-bold text-[var(--foreground)] focus:border-[var(--base-blue)] focus:outline-none"
                />
              </div>
            </div>

            <hr className="border-[var(--border)]" />

            {/* Rate Slider */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-bold text-[var(--foreground)]">Asking Rate ($/hr/unit)</label>
                  <InfoTooltip content="Hourly rate in USD charged per unit. 100 units = 1 underlying token." size={12} />
                </div>
                <span className="font-mono text-xs font-semibold text-[var(--emerald-text)]">
                  ${dailyEarningPerUnit}/day per unit
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0.01"
                  max="2.00"
                  step="0.01"
                  value={pricePerUnitPerHour}
                  onChange={(e) => setPricePerUnitPerHour(e.target.value)}
                  className="h-2 flex-1 cursor-pointer accent-[var(--emerald-text)]"
                />
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-muted)]">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={pricePerUnitPerHour}
                    onChange={(e) => setPricePerUnitPerHour(e.target.value)}
                    className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] pl-6 pr-2.5 py-1 font-mono text-xs font-bold text-[var(--foreground)] focus:border-[var(--base-blue)] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <hr className="border-[var(--border)]" />

            {/* Duration Bounds */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-bold text-[var(--foreground)]">Duration Bounds (Hours)</label>
                  <InfoTooltip content="Acceptable duration window for option contracts matched against this offer." size={12} />
                </div>
                <div className="flex items-center gap-1 font-mono">
                  <button
                    type="button"
                    onClick={() => {
                      setMinHours("1");
                      setMaxHours("24");
                    }}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] cursor-pointer"
                  >
                    1d
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMinHours("1");
                      setMaxHours("168");
                    }}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] cursor-pointer"
                  >
                    1w
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMinHours("1");
                      setMaxHours("720");
                    }}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] cursor-pointer"
                  >
                    30d
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMinHours("1");
                      setMaxHours("2160");
                    }}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] cursor-pointer"
                  >
                    90d
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMinHours("1");
                      setMaxHours("8760");
                    }}
                    className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] cursor-pointer"
                  >
                    1y
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={minHours && Number(minHours) >= 24 ? `Min (${formatDuration(Number(minHours))})` : "Min Hours"}
                  tooltip="Minimum duration in hours a taker can request from this offer."
                >
                  <input
                    type="number"
                    min="1"
                    value={minHours}
                    onChange={(e) => setMinHours(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={maxHours && Number(maxHours) >= 24 ? `Max (${formatDuration(Number(maxHours))})` : "Max Hours"}
                  tooltip="Maximum duration in hours a taker can request from this offer."
                >
                  <input
                    type="number"
                    min="1"
                    value={maxHours}
                    onChange={(e) => setMaxHours(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>

            <hr className="border-[var(--border)]" />

            {/* Option Types Supported */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <label className="text-xs font-bold text-[var(--foreground)]">Option Types Supported</label>
                <InfoTooltip content="Declare whether this offer accommodates buyers seeking Calls, Puts, or either." size={12} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { type: 2, label: "Both (CALL & PUT)", tooltip: "Offer accepts both Bullish Calls and Bearish Puts." },
                  { type: 0, label: "CALL Only", tooltip: "Offer only accepts Bullish Call buyers." },
                  { type: 1, label: "PUT Only", tooltip: "Offer only accepts Bearish Put buyers." },
                ].map((opt) => (
                  <Tooltip key={opt.type} content={opt.tooltip}>
                    <button
                      type="button"
                      onClick={() => setSupportsOptionType(opt.type as OptionTypeSupport)}
                      className={`w-full flex items-center justify-center rounded-lg border py-2 text-xs font-bold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
                        supportsOptionType === opt.type
                          ? "border-[var(--base-blue)] bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] shadow-xs"
                          : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Advanced Settlement Parameters */}
            <div className="border-t border-[var(--border)] pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex min-h-[28px] items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
              >
                <ChevronDownIcon size={12} className={showAdvanced ? "rotate-180 transition-transform" : "transition-transform"} />
                <span>Advanced Settlement Parameters</span>
              </button>

              {showAdvanced && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-xl bg-[var(--surface-raised)] p-3 border border-[var(--border)]">
                  <div className="sm:col-span-2">
                    <Field
                      label="Settlement Condition"
                      tooltip="Smart contract condition verified by the Arbiter during settlement."
                    >
                      <select
                        className={inputClass}
                        value={conditionAddress}
                        onChange={(e) => setConditionAddress(e.target.value as typeof conditionAddress)}
                      >
                        {CONDITIONS.map((c) => (
                          <option key={c.address} value={c.address}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field
                    label="Max Price Age (Seconds)"
                    tooltip="Maximum acceptable delay in oracle round update before rejecting settlement."
                  >
                    <input
                      type="number"
                      className={inputClass}
                      value={maxPriceAge}
                      onChange={(e) => setMaxPriceAge(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Slippage (Bps)"
                    tooltip="Execution slippage limit on Uniswap v4 settlement swaps (100 bps = 1.0%)."
                  >
                    <input
                      type="number"
                      className={inputClass}
                      value={slippageBps}
                      onChange={(e) => setSlippageBps(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>

            <Button
              variant="primary"
              onClick={handleSign}
              disabled={isSigning}
              className="w-full font-bold py-3 text-sm"
            >
              {isSigning
                ? "Signing EIP-712 Offer..."
                : quotingMode === "v4Vault"
                ? "Sign & Publish Uniswap v4 Backed Offer"
                : "Sign & Publish Solo EOA Offer"}
            </Button>
          </Card>
        </div>
      )}

      {/* JSON Payload Export Inspector */}
      {lastExport && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className={labelClass}>Generated EIP-712 Quote Payload</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(lastExport);
                setCopiedIndex(-1);
                setTimeout(() => setCopiedIndex(null), 2000);
              }}
              className="inline-flex items-center gap-1 text-xs text-[var(--base-blue-light)] hover:underline cursor-pointer"
            >
              <CopyIcon size={12} />
              <span>{copiedIndex === -1 ? "Copied!" : "Copy Payload"}</span>
            </button>
          </div>
          <textarea
            readOnly
            value={lastExport}
            rows={5}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3.5 font-mono text-xs text-[var(--foreground)]"
          />
        </div>
      )}

      {/* ─── CARD 3: LIQUIDITY OFFERS & SOURCES TABLE ───────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h2 className={labelClass}>Live Liquidity Offers ({filteredQuotes.length})</h2>
              <InfoTooltip content="Active and historical quotes published to the order book. Filter or inspect liquidity backing sources below." size={12} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1 bg-[var(--surface-raised)] border border-[var(--border)] p-0.5 rounded-lg">
                {(["active", "historical", "all"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setQuoteStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-md font-semibold capitalize transition-colors cursor-pointer ${
                      quoteStatusFilter === st
                        ? "bg-[var(--base-blue)] text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              {isConnected && (
                <div className="flex items-center gap-1 bg-[var(--surface-raised)] border border-[var(--border)] p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setQuoteOwnershipFilter("all")}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                      quoteOwnershipFilter === "all"
                        ? "bg-[var(--surface-overlay)] text-[var(--foreground)] font-bold"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    All Offers
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuoteOwnershipFilter("mine")}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                      quoteOwnershipFilter === "mine"
                        ? "bg-[var(--base-blue)] text-white font-bold"
                        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    My Offers
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setRefreshTick((n) => n + 1)}
                disabled={quotesLoading}
                className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh offers list"
              >
                <RefreshIcon size={12} className={quotesLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {filteredQuotes.map((q, i) => {
              const isVaultQuote = q.backer.toLowerCase() === addresses.v4LiquidityVault.toLowerCase();
              const cp = getCounterparty(q.backer);
              const isMine = !!address && (q.backer.toLowerCase() === address.toLowerCase() || (isVaultQuote && vaultOwner.toLowerCase() === address.toLowerCase()));
              const hash = `${q.backer}-${q.nonce}`;

              return (
                <div
                  key={hash || i}
                  className="flex flex-col gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-xs transition-all hover:border-[var(--border-strong)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="font-bold text-sm text-[var(--foreground)]">{assetSymbol(q.collateralAsset)}</span>
                      <span>·</span>

                      {/* Liquidity Source Badge & Link */}
                      <span className="flex items-center gap-1.5">
                        <span className="font-bold text-[var(--foreground)]">{cp.name}</span>
                        <a
                          href={explorerAddressUrl(q.backer)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--base-blue-light)] hover:underline"
                          title="View on BaseScan"
                        >
                          {shortenAddress(q.backer)} ↗
                        </a>
                      </span>

                      {isVaultQuote && (
                        <Badge tone="purple" tooltip="Collateral staged in Uniswap v4 pool ticks [600, 1200] earning AMM fees.">
                          v4 Staged LP
                        </Badge>
                      )}

                      {isMine && <Badge tone="blue">Your Offer</Badge>}

                      <Badge
                        tone={q.supportsOptionType === 0 ? "emerald" : q.supportsOptionType === 1 ? "amber" : "blue"}
                        tooltip={
                          q.supportsOptionType === 0
                            ? "Supports Call options"
                            : q.supportsOptionType === 1
                            ? "Supports Put options"
                            : "Supports Call & Put options"
                        }
                      >
                        {q.supportsOptionType === 0 ? "CALL" : q.supportsOptionType === 1 ? "PUT" : "CALL & PUT"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(q, null, 2));
                          setCopiedIndex(i);
                          setTimeout(() => setCopiedIndex(null), 2000);
                        }}
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-overlay)] transition-colors cursor-pointer"
                        title="Copy Quote JSON"
                      >
                        <CopyIcon size={13} />
                      </button>

                      {isMine && (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmHash({ hash, hard: false })}
                          className="p-1.5 rounded-lg text-[var(--red-text)] hover:bg-[var(--red-bg)] transition-colors cursor-pointer"
                          title="Deactivate Offer"
                        >
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Liquidity Details Strip */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono pt-1 border-t border-[var(--border)] text-[var(--text-muted)]">
                    <div>
                      Capacity: <strong className="text-[var(--foreground)]">{q.maxUnits.toString()} units</strong> ({Number(q.maxUnits) * 0.01} {assetSymbol(q.collateralAsset)})
                    </div>
                    <div>
                      Rate: <strong className="text-[var(--base-blue-light)]">${formatUnits(q.pricePerUnitPerHour, settlementDecimals)}/hr</strong>
                    </div>
                    <div>
                      Duration: <strong className="text-[var(--foreground)]">{formatDuration(q.minHours)} – {formatDuration(q.maxHours)}</strong>
                    </div>
                    {isVaultQuote && (
                      <div className="text-[#c084fc] font-semibold">
                        Uniswap v4 Backed
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredQuotes.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-xs text-[var(--text-muted)]">
                No liquidity offers match the selected filters.
              </div>
            )}
          </div>
        </div>
      </div>

      {deleteConfirmHash && (
        <ConfirmDialog
          open={!!deleteConfirmHash}
          title="Deactivate Liquidity Offer"
          description="Are you sure you want to deactivate this offer? It will no longer be available to takers."
          confirmText="Deactivate"
          variant="destructive"
          onConfirm={() => {
            const found = quotes.find((q) => `${q.backer}-${q.nonce}` === deleteConfirmHash.hash);
            if (found) handleDeactivateQuote(found);
            setDeleteConfirmHash(null);
          }}
          onCancel={() => setDeleteConfirmHash(null)}
        />
      )}
    </div>
  );
}
