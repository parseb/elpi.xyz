"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address, Hex } from "viem";
import { formatUnits, maxUint256, parseEventLogs } from "viem";
import { usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { addresses } from "@/config/addresses";
import { assetDecimals, assetDisplaySymbol, assetSymbol, assetToUnits, formatAsset, unitsToAsset } from "@/lib/assetLabels";
import { PositionManagerAbi } from "@/generated/abis/PositionManager";
import { LPRouterAbi } from "@/generated/abis/LPRouter";
import { MockERC20Abi } from "@/generated/abis/MockERC20";
import { serializeProfile } from "@/lib/liquidityProfile";
import { serializeQuote } from "@/lib/backerQuote";
import { allocate, splitQueue, type MarketEntry, type QueueStep } from "@/lib/market";
import { formatDurationFull, parseDuration } from "@/lib/charts";
import { isDev } from "@/config/chain";
import { Button, ErrorBanner, InfoTooltip, Tooltip, label as labelClass } from "@/components/ui";
import { CheckIcon, CopyIcon, EditIcon, FlaskIcon } from "@/components/icons";

interface Props {
  selectedAsset?: Address;
  entries: MarketEntry[];
  consumedByHash: Record<Hex, bigint>;
  duration: number;
  onDurationChange?: (v: number) => void;
  desiredUnits: bigint;
  onDesiredUnitsChange?: (v: bigint) => void;
  optionType?: 0 | 1;
  onOptionTypeChange?: (v: 0 | 1) => void;
  address: Address | undefined;
}

export function ExecutionCockpit({
  selectedAsset = addresses.collateralAsset,
  entries,
  consumedByHash,
  duration,
  onDurationChange,
  desiredUnits,
  onDesiredUnitsChange,
  optionType: controlledOptionType,
  onOptionTypeChange,
  address,
}: Props) {
  const [internalOptionType, setInternalOptionType] = useState<0 | 1>(0);
  const optionType = controlledOptionType !== undefined ? controlledOptionType : internalOptionType;
  const setOptionType = (v: 0 | 1) => {
    setInternalOptionType(v);
    onOptionTypeChange?.(v);
  };

  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [tempAmountStr, setTempAmountStr] = useState("");

  const [isEditingDuration, setIsEditingDuration] = useState(false);
  const [tempDurationStr, setTempDurationStr] = useState("");
  const [durationInputUnit, setDurationInputUnit] = useState<"h" | "d">("h");

  const activeAssetSymbol = useMemo(() => {
    if (selectedAsset) return assetDisplaySymbol(selectedAsset);
    if (entries.length > 0) {
      return assetDisplaySymbol(entries[0].data.collateralAsset);
    }
    return "ETH";
  }, [selectedAsset, entries]);

  const hasCallOptions = entries.some((e) => e.data.supportsOptionType === 0 || e.data.supportsOptionType === 2);
  const hasPutOptions = entries.some((e) => e.data.supportsOptionType === 1 || e.data.supportsOptionType === 2);
  const showOptionTypeSelector = hasCallOptions || hasPutOptions || entries.length === 0;

  const allocation = useMemo(() => {
    if (duration <= 0 || desiredUnits <= 0n) return null;
    return allocate(entries, consumedByHash, desiredUnits, duration, optionType);
  }, [entries, consumedByHash, duration, desiredUnits, optionType]);

  const queue: QueueStep[] = useMemo(() => (allocation ? splitQueue(allocation.rows) : []), [allocation]);

  function submitAmountEdit() {
    setIsEditingAmount(false);
    const parsed = parseFloat(tempAmountStr);
    if (!isNaN(parsed) && parsed >= 0 && onDesiredUnitsChange) {
      onDesiredUnitsChange(assetToUnits(parsed));
      setStepIndex(0);
      mint.reset?.();
    }
  }

  function startAmountEdit() {
    if (!onDesiredUnitsChange) return;
    setTempAmountStr(unitsToAsset(desiredUnits).toString());
    setIsEditingAmount(true);
  }

  function startDurationEdit() {
    if (!onDurationChange) return;
    if (duration >= 24) {
      setDurationInputUnit("d");
      const d = duration / 24;
      setTempDurationStr(duration % 24 === 0 ? d.toString() : d.toFixed(1));
    } else {
      setDurationInputUnit("h");
      setTempDurationStr(duration.toString());
    }
    setIsEditingDuration(true);
  }

  function switchDurationUnit(newUnit: "h" | "d") {
    if (newUnit === durationInputUnit) return;
    const currentVal = parseFloat(tempDurationStr);
    if (!isNaN(currentVal) && currentVal > 0) {
      if (newUnit === "d") {
        const d = currentVal / 24;
        setTempDurationStr(currentVal % 24 === 0 ? d.toString() : d.toFixed(1));
      } else {
        setTempDurationStr(Math.round(currentVal * 24).toString());
      }
    }
    setDurationInputUnit(newUnit);
  }

  function submitDurationEdit() {
    setIsEditingDuration(false);
    if (durationInputUnit === "d") {
      const parsed = parseFloat(tempDurationStr);
      if (!isNaN(parsed) && parsed > 0 && onDurationChange) {
        onDurationChange(Math.max(1, Math.min(8760, Math.round(parsed * 24))));
        setStepIndex(0);
        mint.reset?.();
      }
    } else {
      const parsed = parseDuration(tempDurationStr, duration);
      if (onDurationChange) {
        onDurationChange(Math.max(1, Math.min(8760, parsed)));
        setStepIndex(0);
        mint.reset?.();
      }
    }
  }

  const publicClient = usePublicClient();

  const currentStep = queue[stepIndex];

  const targetSettlementAsset = useMemo(() => {
    if (!currentStep) return addresses.settlementAsset;
    if (currentStep.kind === "solo") return currentStep.profile.settlementAsset;
    return currentStep.rows[0]?.quote.settlementAsset ?? addresses.settlementAsset;
  }, [currentStep]);

  const managerAllowance = useReadContract({
    address: targetSettlementAsset,
    abi: MockERC20Abi,
    functionName: "allowance",
    args: address ? [address, addresses.positionManager] : undefined,
    query: { enabled: !!address },
  });

  const routerAllowance = useReadContract({
    address: targetSettlementAsset,
    abi: MockERC20Abi,
    functionName: "allowance",
    args: address ? [address, addresses.lpRouter] : undefined,
    query: { enabled: !!address },
  });

  const balances = useReadContracts({
    contracts: [
      { address: addresses.collateralAsset, abi: MockERC20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
      { address: addresses.wbtcAsset, abi: MockERC20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
      { address: addresses.nvdaAsset, abi: MockERC20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
      { address: addresses.settlementAsset, abi: MockERC20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
    ],
    query: { enabled: !!address },
  });

  const approveManager = useWriteContract();
  const approveRouter = useWriteContract();
  const mint = useWriteContract();
  const faucet = useWriteContract();
  const [faucetPending, setFaucetPending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [minting, setMinting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<{
    positionId?: string;
    account?: Address;
  } | null>(null);

  const readError = balances.isError || managerAllowance.isError || routerAllowance.isError;

  const usdcBalance = (balances.data?.[3]?.result as bigint | undefined) ?? 0n;
  const requiredPremium = allocation?.premium ?? 0n;
  const hasInsufficientUsdc = usdcBalance < requiredPremium;

  const isCurrentStepSolo = currentStep?.kind === "solo";
  const isCurrentStepRouter = currentStep?.kind === "router";

  const hasManagerAllowance = (managerAllowance.data ?? 0n) >= requiredPremium && (managerAllowance.data ?? 0n) > 0n;
  const hasRouterAllowance = (routerAllowance.data ?? 0n) >= requiredPremium && (routerAllowance.data ?? 0n) > 0n;

  const currentStepNeedsApproval =
    (isCurrentStepSolo && !hasManagerAllowance) ||
    (isCurrentStepRouter && !hasRouterAllowance);

  async function handleDevnetFaucet() {
    if (!address) return;
    setError(null);
    setFaucetPending(true);
    try {
      faucet.reset?.();
      const hash = await faucet.writeContractAsync({
        address: targetSettlementAsset,
        abi: MockERC20Abi,
        functionName: "mint",
        args: [address, 10000000000n], // 10,000 mUSDC (6 decimals)
      });
      if (publicClient && hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await balances.refetch();
    } catch (e) {
      faucet.reset?.();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFaucetPending(false);
    }
  }

  async function executeMint() {
    if (!currentStep || !address) return;
    setError(null);
    setMinting(true);
    try {
      let hash: Hex | undefined;
      if (currentStep.kind === "solo") {
        const p = currentStep.profile;
        hash = await mint.writeContractAsync({
          address: addresses.positionManager,
          abi: PositionManagerAbi,
          functionName: "mint",
          args: [
            {
              lp: p.lp,
              collateralAsset: p.collateralAsset,
              settlementAsset: p.settlementAsset,
              minHours: p.minHours,
              maxHours: p.maxHours,
              totalUnits: p.totalUnits,
              pricePerUnitPerHour: p.pricePerUnitPerHour,
              supportsOptionType: p.supportsOptionType,
              unitScalarNum: p.unitScalarNum,
              unitScalarDen: p.unitScalarDen,
              oracle: p.oracle,
              venue: p.venue,
              arbiter: p.arbiter,
              condition: p.condition,
              routeId: p.routeId,
              maxPriceAge: p.maxPriceAge,
              slippageBps: p.slippageBps,
              ackUnverifiedTerms: p.ackUnverifiedTerms,
              chainIds: p.chainIds.map((c) => BigInt(c)),
              timestamp: p.timestamp,
              nonce: p.nonce,
              signature: p.signature,
            },
            currentStep.units,
            duration,
            { oracle: p.oracle, venue: p.venue, arbiter: p.arbiter, condition: p.condition, routeId: p.routeId, maxPriceAge: p.maxPriceAge, slippageBps: p.slippageBps },
            optionType,
            p.ackUnverifiedTerms,
          ],
        });
      } else {
        const first = currentStep.rows[0].quote;
        hash = await mint.writeContractAsync({
          address: addresses.lpRouter,
          abi: LPRouterAbi,
          functionName: "matchAndMint",
          args: [
            currentStep.rows.map((r) => ({ quote: r.quote, units: r.units, signature: r.quote.signature })),
            first.collateralAsset,
            first.settlementAsset,
            first.unitScalarNum,
            first.unitScalarDen,
            first.oracle,
            first.venue,
            first.arbiter,
            first.condition,
            first.routeId,
            first.maxPriceAge,
            first.slippageBps,
            duration,
            optionType,
            false,
          ],
        });
      }

      if (publicClient && hash) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("Transaction reverted on-chain. Please check dev console or node logs.");
        }

        const [event] =
          currentStep.kind === "solo"
            ? parseEventLogs({ abi: PositionManagerAbi, eventName: "PositionMinted", logs: receipt.logs })
            : parseEventLogs({ abi: LPRouterAbi, eventName: "PositionMatched", logs: receipt.logs });

        const posId = event ? (event.args as any).positionId?.toString() : undefined;
        const acc = event ? (event.args as any).account : undefined;

        if (!posId) {
          throw new Error("Position was not minted or matched in event logs.");
        }

        setSuccessMessage({
          positionId: posId,
          account: acc,
        });

        mint.reset?.();
        balances.refetch();
        managerAllowance.refetch();
        routerAllowance.refetch();

        setStepIndex((i) => (i + 1 < queue.length ? i + 1 : 0));

        setTimeout(() => {
          setSuccessMessage(null);
        }, 7000);
      }
    } catch (e) {
      console.error("[ExecutionCockpit] executeMint error:", e);
      mint.reset?.();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }

  async function handleUnifiedAction() {
    if (!currentStep || !address) return;
    if (hasInsufficientUsdc) {
      setError("Insufficient USDC balance to pay option premium.");
      return;
    }
    setError(null);

    // If approval is needed, execute approval and wait for confirmation before minting
    if (currentStepNeedsApproval) {
      setApproving(true);
      try {
        const isSolo = currentStep.kind === "solo";
        const approveContract = isSolo ? approveManager : approveRouter;
        const targetSpender = isSolo ? addresses.positionManager : addresses.lpRouter;

        approveContract.reset?.();
        const hash = await approveContract.writeContractAsync({
          address: targetSettlementAsset,
          abi: MockERC20Abi,
          functionName: "approve",
          args: [targetSpender, maxUint256],
        });

        if (publicClient && hash) {
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash });
          if (approveReceipt.status !== "success") {
            throw new Error("Token approval failed on-chain.");
          }
        }

        if (isSolo) {
          await managerAllowance.refetch();
        } else {
          await routerAllowance.refetch();
        }
      } catch (e) {
        if (currentStep.kind === "solo") approveManager.reset?.();
        else approveRouter.reset?.();
        setError(e instanceof Error ? e.message : String(e));
        return;
      } finally {
        setApproving(false);
      }
    }

    // Sequentially execute the mint
    await executeMint();
  }

  const isActionPending = approving || mint.isPending || minting;

  function getButtonLabel() {
    if (hasInsufficientUsdc) return "Insufficient USDC Balance";
    if (approving) return "Approving USDC...";
    if (mint.isPending) return "Confirm in Wallet...";
    if (minting) return "Minting Option...";
    const actionPrefix = currentStepNeedsApproval ? "Approve & " : "";
    const optionName = optionType === 0 ? "Call" : "Put";
    if (queue.length > 1) {
      return `${actionPrefix}Take Step ${stepIndex + 1}/${queue.length} (${optionName})`;
    }
    return `${actionPrefix}Take ${optionName}`;
  }

  function copySignedObject() {
    if (!allocation) return;
    const soloProfiles = queue.filter((s) => s.kind === "solo").map((s) => serializeProfile(s.profile));
    const routerQuotes = queue.filter((s) => s.kind === "router").flatMap((s) => s.rows.map((r) => serializeQuote(r.quote)));
    const payload = { profiles: soloProfiles, quotes: routerQuotes, desiredUnits: desiredUnits.toString(), durationHours: duration, optionType };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }

  const [collBal, wbtcBal, nvdaBal, usdcBal] = balances.data ?? [];
  const fmt = (v: unknown, dec: number) => (typeof v === "bigint" ? (Number(v) / 10 ** dec).toLocaleString() : "-");

  const isWethActive = selectedAsset.toLowerCase() === addresses.collateralAsset.toLowerCase();
  const isWbtcActive = selectedAsset.toLowerCase() === addresses.wbtcAsset.toLowerCase();
  const isNvdaActive = selectedAsset.toLowerCase() === addresses.nvdaAsset.toLowerCase();

  return (
    <div className="flex flex-col gap-5">
      <div>
        {address && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-xs">
            <Tooltip content="Your mock Wrapped Ether (mWETH) ERC-20 balance on Base.">
              <div className={`cursor-help p-1.5 rounded-lg transition-all ${isWethActive ? "bg-[var(--base-blue-faint)] border border-[var(--base-blue-muted)] shadow-xs ring-1 ring-[var(--base-blue)]/30" : "border border-transparent"}`}>
                <div className="flex items-center justify-between">
                  <span className={`block text-[10px] font-semibold uppercase tracking-wider ${isWethActive ? "text-[var(--base-blue-light)] font-bold" : "text-[var(--text-muted)]"}`}>mWETH</span>
                  {isWethActive && (
                    <span className="text-[9px] font-bold text-[var(--base-blue-light)] bg-[var(--base-blue-muted)]/50 px-1 py-0.2 rounded">Active</span>
                  )}
                </div>
                <span className="font-mono font-bold tabular-nums text-[var(--foreground)]">{fmt(collBal?.result, assetDecimals(addresses.collateralAsset))}</span>
              </div>
            </Tooltip>
            <Tooltip content="Your mock Wrapped Bitcoin (mWBTC) ERC-20 balance on Base.">
              <div className={`cursor-help p-1.5 rounded-lg transition-all ${isWbtcActive ? "bg-[var(--base-blue-faint)] border border-[var(--base-blue-muted)] shadow-xs ring-1 ring-[var(--base-blue)]/30" : "border border-transparent"}`}>
                <div className="flex items-center justify-between">
                  <span className={`block text-[10px] font-semibold uppercase tracking-wider ${isWbtcActive ? "text-[var(--base-blue-light)] font-bold" : "text-[var(--text-muted)]"}`}>mWBTC</span>
                  {isWbtcActive && (
                    <span className="text-[9px] font-bold text-[var(--base-blue-light)] bg-[var(--base-blue-muted)]/50 px-1 py-0.2 rounded">Active</span>
                  )}
                </div>
                <span className="font-mono font-bold tabular-nums text-[var(--foreground)]">{fmt(wbtcBal?.result, assetDecimals(addresses.wbtcAsset))}</span>
              </div>
            </Tooltip>
            <Tooltip content="Your mock NVIDIA (mNVDA) equity token balance on Base.">
              <div className={`cursor-help p-1.5 rounded-lg transition-all ${isNvdaActive ? "bg-[var(--base-blue-faint)] border border-[var(--base-blue-muted)] shadow-xs ring-1 ring-[var(--base-blue)]/30" : "border border-transparent"}`}>
                <div className="flex items-center justify-between">
                  <span className={`block text-[10px] font-semibold uppercase tracking-wider ${isNvdaActive ? "text-[var(--base-blue-light)] font-bold" : "text-[var(--text-muted)]"}`}>mNVDA</span>
                  {isNvdaActive && (
                    <span className="text-[9px] font-bold text-[var(--base-blue-light)] bg-[var(--base-blue-muted)]/50 px-1 py-0.2 rounded">Active</span>
                  )}
                </div>
                <span className="font-mono font-bold tabular-nums text-[var(--foreground)]">{fmt(nvdaBal?.result, assetDecimals(addresses.nvdaAsset))}</span>
              </div>
            </Tooltip>
            <Tooltip content="Your mock USD Coin (mUSDC) balance used to pay option premiums.">
              <div className="cursor-help p-1.5 rounded-lg border border-transparent">
                <span className="text-[var(--text-muted)] block text-[10px] font-semibold uppercase tracking-wider">mUSDC</span>
                <span className="font-mono font-bold tabular-nums text-[var(--foreground)]">{fmt(usdcBal?.result, assetDecimals(addresses.settlementAsset))}</span>
              </div>
            </Tooltip>
          </div>
        )}
      </div>

      {readError && <ErrorBanner message="RPC sync failed." />}

      {duration <= 0 || desiredUnits <= 0n ? (
        <div className="rounded-xl border border-dashed border-[var(--border-hover)] bg-[var(--surface-raised)] p-6 text-center text-xs text-[var(--text-muted)]">
          <p className="font-semibold text-[var(--foreground)]">No Selection</p>
        </div>
      ) : (
        <>
          {showOptionTypeSelector && (
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-[var(--text-muted)]">Option Type</span>
                <InfoTooltip content="Call options gain value if the spot price rises above entry. Put options gain value if the spot price falls below entry." size={12} />
              </div>
              <div role="tablist" aria-label="Option Type Selection" className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1">
                <button
                  role="tab"
                  aria-selected={optionType === 0}
                  type="button"
                  onClick={() => setOptionType(0)}
                  className={`min-h-[32px] rounded-lg text-xs font-bold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
                    optionType === 0
                      ? "bg-[var(--base-blue)] text-white shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  CALL (Bullish)
                </button>
                <button
                  role="tab"
                  aria-selected={optionType === 1}
                  type="button"
                  onClick={() => setOptionType(1)}
                  className={`min-h-[32px] rounded-lg text-xs font-bold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
                    optionType === 1
                      ? "bg-[var(--amber-bg)] text-[var(--amber-text)] border border-[var(--amber-border)] shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  PUT (Bearish)
                </button>
              </div>
            </div>
          )}

          <div className="group relative rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] p-4 shadow-xs transition-all hover:border-[var(--base-blue-light)] hover:bg-[var(--surface-overlay)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className={labelClass}>Matched Units</span>
                <InfoTooltip content="Total size of the underlying asset matched across active LP quotes." size={12} />
              </div>
            </div>

            {isEditingAmount ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tempAmountStr}
                  onChange={(e) => setTempAmountStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitAmountEdit();
                    if (e.key === "Escape") setIsEditingAmount(false);
                  }}
                  onBlur={submitAmountEdit}
                  autoFocus
                  aria-label="Target amount"
                  className="w-full rounded-lg border-2 border-[var(--base-blue)] bg-[var(--surface-raised)] px-3 py-1 font-mono text-xl font-bold text-[var(--foreground)] outline-none ring-2 ring-[var(--base-blue-muted)]"
                />
                <span className="font-mono text-sm font-bold text-[var(--text-muted)]">{activeAssetSymbol}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={startAmountEdit}
                aria-label="Edit amount"
                className="mt-1 flex w-full items-center justify-between cursor-pointer rounded-lg py-1 px-1 -mx-1 hover:bg-[var(--base-blue-faint)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                title="Click to edit amount"
              >
                <div className="font-mono text-2xl font-bold tabular-nums text-[var(--base-blue-light)]">
                  {formatAsset(allocation?.totalUnits ?? 0n, activeAssetSymbol)}
                </div>
                <span className="flex items-center gap-1 text-xs font-semibold text-[var(--base-blue-light)] opacity-0 group-hover:opacity-100 transition-opacity">
                  <EditIcon size={12} />
                  <span>Edit</span>
                </span>
              </button>
            )}
            
            <div className="mt-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                <span className={labelClass}>Duration</span>
                <InfoTooltip content="Contract lifespan. LP price is quoted per unit per hour." size={12} />
              </div>
              {isEditingDuration ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step={durationInputUnit === "d" ? "0.1" : "1"}
                    min={durationInputUnit === "d" ? "0.1" : "1"}
                    max={durationInputUnit === "d" ? "365" : "8760"}
                    value={tempDurationStr}
                    onChange={(e) => setTempDurationStr(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitDurationEdit();
                      if (e.key === "Escape") setIsEditingDuration(false);
                    }}
                    onBlur={submitDurationEdit}
                    autoFocus
                    aria-label="Duration value"
                    className="w-16 rounded-lg border border-[var(--base-blue)] bg-[var(--surface-overlay)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--foreground)] outline-none ring-1 ring-[var(--base-blue)]"
                  />
                  <div role="group" aria-label="Duration unit" className="flex rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5">
                    <button
                      type="button"
                      onClick={() => switchDurationUnit("h")}
                      className={`px-1.5 py-0.5 text-xs font-bold rounded cursor-pointer transition-colors ${
                        durationInputUnit === "h"
                          ? "bg-[var(--base-blue)] text-white"
                          : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      h
                    </button>
                    <button
                      type="button"
                      onClick={() => switchDurationUnit("d")}
                      className={`px-1.5 py-0.5 text-xs font-bold rounded cursor-pointer transition-colors ${
                        durationInputUnit === "d"
                          ? "bg-[var(--base-blue)] text-white"
                          : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      d
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startDurationEdit}
                  aria-label="Edit duration"
                  className="group/dur inline-flex min-h-[28px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-mono font-bold tabular-nums text-[var(--foreground)] transition-all hover:bg-[var(--surface-overlay)] hover:border-[var(--base-blue)] hover:text-[var(--base-blue-light)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                  title="Click to edit duration (hours or days)"
                >
                  <span>{formatDurationFull(duration)}</span>
                  <span className="text-xs text-[var(--base-blue-light)] opacity-70 group-hover/dur:opacity-100 transition-opacity">
                    <EditIcon size={12} />
                  </span>
                </button>
              )}
            </div>

            <div className="mt-2.5 flex items-center gap-1">
              <span className={labelClass}>Total Premium</span>
              <InfoTooltip content="Upfront cost paid in USDC to the LP for the contract rights over the chosen duration." size={12} />
            </div>
            <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-[var(--foreground)]">
              $
              {Number(formatUnits(allocation?.premium ?? 0n, assetDecimals(addresses.settlementAsset))).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </div>
            
            {allocation && allocation.shortfall > 0n && (
              <p className="mt-2 text-xs font-semibold text-[var(--amber-text)]">
                Partial Fill: {formatAsset(allocation.totalUnits, activeAssetSymbol)} / {formatAsset(desiredUnits, activeAssetSymbol)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            {/* Devnet Faucet Banner if USDC balance is low */}
            {isDev && hasInsufficientUsdc && (
              <div className="rounded-xl border border-[var(--base-blue-muted)] bg-[var(--base-blue-faint)] p-3 text-xs text-[var(--base-blue-light)] flex flex-col gap-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <FlaskIcon size={14} />
                  <span>Devnet Test Funds Required</span>
                </div>
                <p className="text-[var(--text-muted)] text-[11px]">
                  Your wallet has <strong>${Number(formatUnits(usdcBalance, assetDecimals(addresses.settlementAsset))).toFixed(2)}</strong> USDC (need <strong>${Number(formatUnits(requiredPremium, assetDecimals(addresses.settlementAsset))).toFixed(2)}</strong>).
                </p>
                <Button
                  variant="secondary"
                  onClick={handleDevnetFaucet}
                  disabled={faucetPending}
                  className="w-full text-xs font-bold"
                >
                  {faucetPending ? "Minting Test Funds..." : "Mint 10,000 mUSDC (Devnet Faucet)"}
                </Button>
              </div>
            )}

            {/* Single Consolidated Action Button */}
            {queue.length > 0 && currentStep && (
              <Button
                variant={hasInsufficientUsdc ? "secondary" : "primary"}
                onClick={handleUnifiedAction}
                disabled={isActionPending || hasInsufficientUsdc}
                className="w-full font-bold min-h-[42px] text-sm"
              >
                {getButtonLabel()}
              </Button>
            )}

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={copySignedObject}
                disabled={!allocation || allocation.rows.length === 0}
                className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--foreground)] disabled:opacity-40 cursor-pointer py-1 px-1.5 transition-colors"
                title="Copy signed order JSON"
              >
                <CopyIcon size={12} />
                <span>JSON</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-2 flex flex-col gap-1.5">
              <ErrorBanner message={error} />
              {isDev && error.toLowerCase().includes("nonce") && (
                <div className="rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] p-2.5 text-[11px] text-[var(--text-muted)]">
                  <strong>MetaMask Nonce Desync:</strong> Anvil was restarted. In MetaMask: <em>Settings &rarr; Advanced &rarr; Clear activity tab data</em> to reset transaction nonces.
                </div>
              )}
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              aria-live="polite"
              className="mt-2 flex flex-col gap-1.5 rounded-xl border border-[var(--emerald-border)] bg-[var(--emerald-bg)] p-3 text-xs text-[var(--foreground)] animate-in fade-in slide-in-from-top-1 duration-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold text-[var(--emerald-text)]">
                  <CheckIcon size={16} />
                  <span>
                    {successMessage.positionId ? `Position #${successMessage.positionId} Minted!` : "Position Confirmed!"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSuccessMessage(null)}
                  className="text-[var(--text-muted)] hover:text-[var(--foreground)] cursor-pointer text-xs font-bold px-1"
                  aria-label="Dismiss notification"
                >
                  ✕
                </button>
              </div>

              {successMessage.account && (
                <div className="font-mono text-[11px] text-[var(--text-muted)] truncate" title={successMessage.account}>
                  Account: {successMessage.account}
                </div>
              )}

              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-[var(--emerald-text)] font-medium">Position active in Portfolio.</span>
                <Link
                  href="/positions"
                  className="font-bold text-[var(--base-blue-light)] hover:underline flex items-center gap-0.5"
                >
                  View in Portfolio &rarr;
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

