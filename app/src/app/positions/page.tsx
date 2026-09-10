"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  useConnection,
  usePublicClient,
  useReadContracts,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { formatUnits, parseEventLogs, type Address } from "viem";
import { addresses } from "@/config/addresses";
import { PositionManagerAbi } from "@/generated/abis/PositionManager";
import { PositionAccountAbi } from "@/generated/abis/PositionAccount";
import { MockPriceOracleAbi } from "@/generated/abis/MockPriceOracle";
import {
  ActionKind,
  actionDomain,
  actionMessage,
  actionTypes,
  encodeArbiterApproval,
  encodeSettleToTakerParams,
  type ActionContextValue,
  type EconomicsStruct,
  type PointersStruct,
} from "@/lib/actionContext";
import { isDev } from "@/config/chain";
import { Badge, Card, ErrorBanner, InfoTooltip, PageHeader, StatTile, Tooltip } from "@/components/ui";
import { ConnectButton } from "@/components/ConnectButton";
import { CheckIcon, FilterIcon, RefreshIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import { assetDisplaySymbol, assetSymbol, formatExpiryCountdown, formatExpiryDateHover, unitsToAsset } from "@/lib/assetLabels";
import { getCounterparty } from "@/lib/counterparties";

export interface OwnedPosition {
  positionId: bigint;
  account: Address;
  owner: Address;
  isOwner: boolean;
  isLp: boolean;
  accountState: bigint;
  economics: EconomicsStruct;
  pointers: PointersStruct;
}

export default function PositionsPage() {
  const { isConnected, address } = useConnection();
  const publicClient = usePublicClient();
  const [positions, setPositions] = useState<OwnedPosition[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [selectedAssetFilter, setSelectedAssetFilter] = useState<string>("all");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<"all" | "taker" | "lp">("all");

  const [closingId, setClosingId] = useState<bigint | null>(null);
  const [closeStatus, setCloseStatus] = useState<"idle" | "signing" | "submitting" | "confirmed" | "error">("idle");
  const [closeError, setCloseError] = useState<string | null>(null);

  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  // Read Live Oracle Prices for WETH, WBTC, and NVDA
  const oracleReads = useReadContracts({
    contracts: [
      {
        address: addresses.priceOracle,
        abi: MockPriceOracleAbi,
        functionName: "price",
        args: [addresses.collateralAsset, addresses.settlementAsset],
      },
      {
        address: addresses.btcPriceOracle,
        abi: MockPriceOracleAbi,
        functionName: "price",
        args: [addresses.wbtcAsset, addresses.settlementAsset],
      },
      {
        address: addresses.nvdaPriceOracle,
        abi: MockPriceOracleAbi,
        functionName: "price",
        args: [addresses.nvdaAsset, addresses.settlementAsset],
      },
    ],
    query: { staleTime: 10_000 },
  });

  const ethPrice = oracleReads.data?.[0]?.result ? (oracleReads.data[0].result as readonly [bigint, bigint])[0] : 3000n * 10n ** 18n;
  const btcPrice = oracleReads.data?.[1]?.result ? (oracleReads.data[1].result as readonly [bigint, bigint])[0] : 60000n * 10n ** 18n;
  const nvdaPrice = oracleReads.data?.[2]?.result ? (oracleReads.data[2].result as readonly [bigint, bigint])[0] : 130n * 10n ** 18n;

  const oraclePrices: Record<string, bigint> = useMemo(() => ({
    [addresses.collateralAsset.toLowerCase()]: ethPrice,
    [addresses.wbtcAsset.toLowerCase()]: btcPrice,
    [addresses.nvdaAsset.toLowerCase()]: nvdaPrice,
  }), [ethPrice, btcPrice, nvdaPrice]);

  useEffect(() => {
    if (!publicClient || !address) return;
    let cancelled = false;

    async function fetchPositions() {
      setLoading(true);
      setError(null);
      try {
        let fromBlock = 0n;
        if (!isDev) {
          try {
            const currentBlock = await publicClient!.getBlockNumber();
            fromBlock = currentBlock > 20000n ? currentBlock - 20000n : 0n;
          } catch {
            fromBlock = 0n;
          }
        }

        const logs = await publicClient!.getContractEvents({
          address: addresses.positionManager,
          abi: PositionManagerAbi,
          eventName: "PositionMinted",
          fromBlock,
          toBlock: "latest",
        });

        const parsed = parseEventLogs({ abi: PositionManagerAbi, eventName: "PositionMinted", logs });

        if (parsed.length === 0) {
          if (!cancelled) setPositions([]);
          return;
        }

        // Fetch position owner and state safely across all network configurations
        const positionsWithDetails = await Promise.all(
          parsed.map(async (e) => {
            let owner: Address | null = null;
            let accountState = 0n;
            try {
              owner = await publicClient!.readContract({
                address: addresses.positionManager,
                abi: PositionManagerAbi,
                functionName: "ownerOf",
                args: [e.args.positionId],
              });
            } catch {
              owner = null;
            }
            try {
              accountState = await publicClient!.readContract({
                address: e.args.account,
                abi: PositionAccountAbi,
                functionName: "accountState",
              });
            } catch {
              accountState = 0n;
            }
            return { event: e, owner, accountState };
          }),
        );

        // Filter positions where connected wallet is the NFT owner (taker) or the LP
        const userPositions = positionsWithDetails.filter(
          ({ event, owner }) =>
            (owner && owner.toLowerCase() === address!.toLowerCase()) ||
            event.args.economics.lp.toLowerCase() === address!.toLowerCase(),
        );

        const items: (OwnedPosition & { accountState: bigint })[] = userPositions.map(({ event: e, owner, accountState }) => ({
          positionId: e.args.positionId,
          account: e.args.account,
          owner: owner ?? (e.args.economics.lp as Address),
          isOwner: !!owner && owner.toLowerCase() === address!.toLowerCase(),
          isLp: e.args.economics.lp.toLowerCase() === address!.toLowerCase(),
          accountState,
          economics: {
            lp: e.args.economics.lp,
            collateralAsset: e.args.economics.collateralAsset,
            settlementAsset: e.args.economics.settlementAsset,
            collateralDecimals: e.args.economics.collateralDecimals,
            settlementDecimals: e.args.economics.settlementDecimals,
            optionType: e.args.economics.optionType,
            units: e.args.economics.units,
            unitScalarNum: e.args.economics.unitScalarNum,
            unitScalarDen: e.args.economics.unitScalarDen,
            entryPrice: e.args.economics.entryPrice,
            expiry: e.args.economics.expiry,
            feeBps: e.args.economics.feeBps,
          },
          pointers: {
            oracle: e.args.pointers.oracle,
            venue: e.args.pointers.venue,
            arbiter: e.args.pointers.arbiter,
            condition: e.args.pointers.condition,
            routeId: e.args.pointers.routeId,
            maxPriceAge: e.args.pointers.maxPriceAge,
            slippageBps: e.args.pointers.slippageBps,
          },
        }));

        if (!cancelled) setPositions(items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPositions();
    return () => {
      cancelled = true;
    };
  }, [publicClient, address, refreshTick]);

  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));

  const enrichedPositions = useMemo(() => {
    if (!positions) return [];
    return positions.map((p) => {
      const isSettled = p.accountState > 0n;
      const isExpired = nowSec >= Number(p.economics.expiry);
      const isTakerProfit = true;
      const status: "Active" | "Settled" | "Expired" = isSettled
        ? "Settled"
        : isExpired
        ? "Expired"
        : "Active";

      const livePrice = oraclePrices[p.economics.collateralAsset.toLowerCase()] ?? p.economics.entryPrice;
      const entryPriceVal = Number(formatUnits(p.economics.entryPrice, 18));
      const livePriceVal = Number(formatUnits(livePrice, 18));
      const assetSize = unitsToAsset(p.economics.units);

      let isItm = false;
      let pnlUsd = 0;
      let pnlPct = 0;

      if (p.economics.optionType === 0) {
        // CALL: profitable if live > entry, unprofitable (negative) if live < entry
        isItm = livePriceVal > entryPriceVal;
        pnlUsd = (livePriceVal - entryPriceVal) * assetSize;
        pnlPct = entryPriceVal > 0 ? ((livePriceVal - entryPriceVal) / entryPriceVal) * 100 : 0;
      } else {
        // PUT: profitable if live < entry, unprofitable (negative) if live > entry
        isItm = livePriceVal < entryPriceVal;
        pnlUsd = (entryPriceVal - livePriceVal) * assetSize;
        pnlPct = entryPriceVal > 0 ? ((entryPriceVal - livePriceVal) / entryPriceVal) * 100 : 0;
      }

      return {
        ...p,
        status,
        isSettled,
        isExpired,
        isTakerProfit,
        livePrice,
        entryPriceVal,
        livePriceVal,
        assetSize,
        isItm,
        pnlUsd,
        pnlPct,
      };
    });
  }, [positions, nowSec, oraclePrices]);

  const activePositions = useMemo(
    () => enrichedPositions.filter((p) => p.status === "Active"),
    [enrichedPositions],
  );

  const historyPositions = useMemo(
    () => enrichedPositions.filter((p) => p.status !== "Active"),
    [enrichedPositions],
  );

  // Portfolio Totals
  const totalActiveCollateralEth = useMemo(() => {
    return activePositions
      .filter((p) => p.economics.collateralAsset.toLowerCase() === addresses.collateralAsset.toLowerCase())
      .reduce((sum, p) => sum + p.assetSize, 0);
  }, [activePositions]);

  const totalActiveCollateralBtc = useMemo(() => {
    return activePositions
      .filter((p) => p.economics.collateralAsset.toLowerCase() === addresses.wbtcAsset.toLowerCase())
      .reduce((sum, p) => sum + p.assetSize, 0);
  }, [activePositions]);

  const totalActiveCollateralNvda = useMemo(() => {
    return activePositions
      .filter((p) => p.economics.collateralAsset.toLowerCase() === addresses.nvdaAsset.toLowerCase())
      .reduce((sum, p) => sum + p.assetSize, 0);
  }, [activePositions]);

  const totalUnrealizedPnl = useMemo(() => {
    return activePositions
      .filter((p) => p.isOwner)
      .reduce((sum, p) => sum + p.pnlUsd, 0);
  }, [activePositions]);

  // One-click Close / Settle Position Action for Takers
  async function handleClosePosition(position: (typeof enrichedPositions)[0]) {
    if (!publicClient || !address) return;
    setClosingId(position.positionId);
    setCloseStatus("signing");
    setCloseError(null);

    try {
      const chainNow = await publicClient.getBlock().then((b) => b.timestamp);
      const [accountState, signerEpoch, oracleRes] = await Promise.all([
        publicClient.readContract({
          address: position.account,
          abi: PositionAccountAbi,
          functionName: "accountState",
        }),
        publicClient.readContract({
          address: addresses.positionManager,
          abi: PositionManagerAbi,
          functionName: "signerEpochOf",
          args: [position.positionId],
        }),
        publicClient.readContract({
          address: position.pointers.oracle,
          abi: MockPriceOracleAbi,
          functionName: "price",
          args: [position.economics.collateralAsset, position.economics.settlementAsset],
        }),
      ]);

      const currentLivePrice = oracleRes[0];
      const updatedAt = oracleRes[1];

      // Pre-flight check: not already settled
      if (accountState > 0n) {
        throw new Error("This position has already been settled on-chain.");
      }

      // Pre-flight check: strict on-chain profitability
      const isCall = position.economics.optionType === 0;
      const signedPnl = isCall
        ? currentLivePrice - position.economics.entryPrice
        : position.economics.entryPrice - currentLivePrice;

      if (signedPnl <= 0n) {
        throw new Error(
          `Position is not profitable at live oracle price ($${Number(formatUnits(currentLivePrice, 18)).toFixed(2)} vs entry $${Number(formatUnits(position.economics.entryPrice, 18)).toFixed(2)}). Options contracts require positive PnL to exercise.`,
        );
      }

      // Pre-flight check: oracle freshness
      if (chainNow > updatedAt && chainNow - updatedAt > BigInt(position.pointers.maxPriceAge)) {
        throw new Error(
          `Oracle price is stale (age ${Number(chainNow - updatedAt)}s exceeds max ${position.pointers.maxPriceAge}s). Please refresh or update the oracle feed.`,
        );
      }

      const params = encodeSettleToTakerParams({
        exitPrice: currentLivePrice,
        minAmountOut: 0n,
        minPayoutToTaker: 0n,
        swapDeadline: chainNow + 3600n,
      });

      const ctx: ActionContextValue = {
        account: position.account,
        implementation: addresses.positionAccountImplementation,
        homeChainId: BigInt(addresses.chainId),
        positionManager: addresses.positionManager,
        positionId: position.positionId,
        accountState,
        signerEpoch,
        actionKind: ActionKind.SettleToTaker,
        params,
        deadline: chainNow + 3600n,
        economics: position.economics,
        pointers: position.pointers,
      };

      // 1. Taker EIP-712 signature (Slot 1)
      const takerSignature = await signTypedDataAsync({
        domain: actionDomain(position.account),
        types: actionTypes,
        primaryType: "Action",
        message: actionMessage(ctx),
      });

      // 2. Arbiter auto-approval (Slot 2)
      const arbiterApproval = encodeArbiterApproval(ctx);

      setCloseStatus("submitting");

      // 3. Submit on-chain
      const hash = await writeContractAsync({
        address: position.account,
        abi: PositionAccountAbi,
        functionName: "settleToTaker",
        args: [
          ctx,
          [
            { slot: 1, signature: takerSignature },
            { slot: 2, signature: arbiterApproval },
          ],
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted on-chain (tx: ${hash.slice(0, 10)}...). Status: ${receipt.status}`);
      }

      setCloseStatus("confirmed");
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : String(err));
      setCloseStatus("error");
    } finally {
      setClosingId(null);
    }
  }

  // Settle Expired Position for LPs
  async function handleSettleLp(position: (typeof enrichedPositions)[0]) {
    if (!publicClient || !address) return;
    setClosingId(position.positionId);
    setCloseStatus("signing");
    setCloseError(null);

    try {
      const chainNow = await publicClient.getBlock().then((b) => b.timestamp);
      const [accountState, signerEpoch] = await Promise.all([
        publicClient.readContract({
          address: position.account,
          abi: PositionAccountAbi,
          functionName: "accountState",
        }),
        publicClient.readContract({
          address: addresses.positionManager,
          abi: PositionManagerAbi,
          functionName: "signerEpochOf",
          args: [position.positionId],
        }),
      ]);

      const ctx: ActionContextValue = {
        account: position.account,
        implementation: addresses.positionAccountImplementation,
        homeChainId: BigInt(addresses.chainId),
        positionManager: addresses.positionManager,
        positionId: position.positionId,
        accountState,
        signerEpoch,
        actionKind: ActionKind.SettleToLp,
        params: "0x",
        deadline: chainNow + 3600n,
        economics: position.economics,
        pointers: position.pointers,
      };

      const lpSignature = await signTypedDataAsync({
        domain: actionDomain(position.account),
        types: actionTypes,
        primaryType: "Action",
        message: actionMessage(ctx),
      });

      const arbiterApproval = encodeArbiterApproval(ctx);
      setCloseStatus("submitting");

      const hash = await writeContractAsync({
        address: position.account,
        abi: PositionAccountAbi,
        functionName: "settleToLp",
        args: [
          ctx,
          [
            { slot: 0, signature: lpSignature },
            { slot: 2, signature: arbiterApproval },
          ],
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted on-chain (tx: ${hash.slice(0, 10)}...). Status: ${receipt.status}`);
      }
      setCloseStatus("confirmed");
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : String(err));
      setCloseStatus("error");
    } finally {
      setClosingId(null);
    }
  }

  const filteredPositions = useMemo(() => {
    let list = activeTab === "active" ? activePositions : historyPositions;

    if (selectedAssetFilter !== "all") {
      list = list.filter((p) => {
        const sym = assetSymbol(p.economics.collateralAsset).toLowerCase();
        const displaySym = assetDisplaySymbol(p.economics.collateralAsset).toLowerCase();
        const filter = selectedAssetFilter.toLowerCase();
        return sym === filter || displaySym === filter;
      });
    }

    if (selectedRoleFilter === "taker") {
      list = list.filter((p) => p.isOwner);
    } else if (selectedRoleFilter === "lp") {
      list = list.filter((p) => p.isLp);
    }

    return list;
  }, [activeTab, activePositions, historyPositions, selectedAssetFilter, selectedRoleFilter]);

  const currentList = filteredPositions;

  return (
    <div className="flex flex-col gap-6">
      {/* Portfolio Header & Live Oracle Tracker */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <PageHeader
            title="Portfolio"
            tooltip="View and manage your active and historical options positions minted on Base."
          />
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Manage your active options positions, monitor real-time profitability, and execute instant settlements.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Live Price Badges with Tooltips */}
          <div className="flex items-center gap-2 text-xs font-mono bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-1.5 rounded-xl">
            <Tooltip content="Live Base oracle feed price for WETH / USDC pair.">
              <span className="flex items-center gap-1.5 text-[var(--foreground)] font-bold cursor-help">
                <span className="h-2 w-2 rounded-full bg-[var(--emerald-text)] animate-pulse" />
                ETH: ${Number(formatUnits(ethPrice, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </Tooltip>
            <span className="text-[var(--border-strong)]">|</span>
            <Tooltip content="Live Base oracle feed price for WBTC / USDC pair.">
              <span className="text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors cursor-help">
                BTC: ${Number(formatUnits(btcPrice, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </Tooltip>
            <span className="text-[var(--border-strong)]">|</span>
            <Tooltip content="Live Base oracle feed price for NVDA / USDC pair.">
              <span className="text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors cursor-help">
                NVDA: ${Number(formatUnits(nvdaPrice, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </Tooltip>
          </div>

          {isConnected && (
            <button
              type="button"
              onClick={() => setRefreshTick((t) => t + 1)}
              disabled={loading}
              className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-bold text-[var(--foreground)] hover:bg-[var(--surface-overlay)] transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh positions from blockchain"
            >
              <RefreshIcon size={13} className={loading ? "animate-spin" : ""} />
              <span>{loading ? "Refreshing..." : "Refresh"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Wallet Disconnected State */}
      {!isConnected && (
        <Card>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <h3 className="text-base font-semibold text-[var(--foreground)]">Connect your wallet</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mt-1 mb-4">
              Connect to Base to view your active options, track real-time PnL, and close profitable positions.
            </p>
            <ConnectButton />
          </div>
        </Card>
      )}

      {/* Portfolio Summary Metrics Bar */}
      {isConnected && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Active Position Size"
            tooltip="Sum of underlying asset notional across all active contracts."
            value={
              <span className="font-mono text-lg font-extrabold text-[var(--foreground)]">
                {totalActiveCollateralEth > 0 && `${totalActiveCollateralEth.toLocaleString(undefined, { maximumFractionDigits: 2 })} ETH`}
                {totalActiveCollateralBtc > 0 && `${totalActiveCollateralEth > 0 ? " + " : ""}${totalActiveCollateralBtc.toLocaleString(undefined, { maximumFractionDigits: 2 })} BTC`}
                {totalActiveCollateralNvda > 0 && `${(totalActiveCollateralEth > 0 || totalActiveCollateralBtc > 0) ? " + " : ""}${totalActiveCollateralNvda.toLocaleString(undefined, { maximumFractionDigits: 2 })} NVDA`}
                {totalActiveCollateralEth === 0 && totalActiveCollateralBtc === 0 && totalActiveCollateralNvda === 0 && "0 ETH"}
              </span>
            }
            sub={`${activePositions.length} active ${activePositions.length === 1 ? "contract" : "contracts"}`}
          />

          <StatTile
            label="Unrealized PnL (Taker)"
            tooltip="Calculated as (Live Price - Entry Price) * Units for Calls, or (Entry Price - Live Price) * Units for Puts."
            value={
              <span className={`font-mono text-lg font-extrabold ${
                totalUnrealizedPnl > 0
                  ? "text-[var(--emerald-text)]"
                  : totalUnrealizedPnl < 0
                  ? "text-[var(--red-text)]"
                  : "text-[var(--foreground)]"
              }`}>
                {totalUnrealizedPnl > 0
                  ? `+$${totalUnrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : totalUnrealizedPnl < 0
                  ? `-$${Math.abs(totalUnrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "$0.00"}
              </span>
            }
            sub={
              totalUnrealizedPnl > 0
                ? "In the money · ready to close"
                : totalUnrealizedPnl < 0
                ? "Out of the money"
                : "Market tracking"
            }
          />

          <StatTile
            label="Active Contracts"
            tooltip="Contracts currently live on-chain that have not expired or been settled."
            value={
              <span className="font-mono text-lg font-extrabold text-[var(--base-blue-light)]">
                {activePositions.length}
              </span>
            }
            sub={`${enrichedPositions.filter((p) => p.isOwner).length} Taker / ${enrichedPositions.filter((p) => p.isLp).length} LP`}
          />

          <StatTile
            label="Settled / Closed"
            tooltip="Historical contracts that reached expiration or exercised profit settlement."
            value={
              <span className="font-mono text-lg font-extrabold text-[var(--text-muted)]">
                {historyPositions.length}
              </span>
            }
            sub="Historical executions"
          />
        </div>
      )}

      {/* Transaction Notifications & Alerts */}
      {error && (
        <ErrorBanner message={`Failed to load positions: ${error}`} onRetry={() => setRefreshTick((t) => t + 1)} />
      )}
      {closeError && (
        <ErrorBanner message={`Failed to execute position settlement: ${closeError}`} onRetry={() => setCloseError(null)} />
      )}
      {closeStatus === "confirmed" && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--emerald-border)] bg-[var(--emerald-bg)] p-3.5 text-xs font-bold text-[var(--emerald-text)]">
          <CheckIcon size={16} />
          <span>Position successfully closed and profit settled to your wallet!</span>
        </div>
      )}

      {/* Tab & Filter Navigation */}
      {isConnected && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-1">
            <div role="tablist" aria-label="Portfolio sections" className="flex gap-4 text-sm font-bold">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "active"}
                onClick={() => setActiveTab("active")}
                className={`pb-2.5 transition-colors cursor-pointer relative ${
                  activeTab === "active"
                    ? "text-[var(--base-blue-light)]"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <span>Active Positions</span>
                <span className="ml-1.5 rounded-full bg-[var(--base-blue-faint)] px-2 py-0.5 text-xs text-[var(--base-blue-light)] border border-[var(--base-blue-muted)]">
                  {activePositions.length}
                </span>
                {activeTab === "active" && (
                  <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[var(--base-blue)]" />
                )}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "history"}
                onClick={() => setActiveTab("history")}
                className={`pb-2.5 transition-colors cursor-pointer relative ${
                  activeTab === "history"
                    ? "text-[var(--base-blue-light)]"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <span>History</span>
                <span className="ml-1.5 rounded-full bg-[var(--surface-overlay)] px-2 py-0.5 text-xs text-[var(--text-muted)] border border-[var(--border)]">
                  {historyPositions.length}
                </span>
                {activeTab === "history" && (
                  <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[var(--base-blue)]" />
                )}
              </button>
            </div>

            <Link
              href="/"
              className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--base-blue)] px-3 text-xs font-bold text-white hover:bg-[var(--base-blue-hover)] transition-colors shadow-xs"
            >
              + Take New Position
            </Link>
          </div>

          {/* Filter Chips Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 py-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 text-[var(--text-muted)] font-medium">
                <FilterIcon size={12} />
                Asset:
              </span>
              {(["all", "eth", "btc", "nvda"] as const).map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSelectedAssetFilter(sym)}
                  className={`px-2.5 py-1 rounded-lg font-mono font-semibold transition-colors cursor-pointer ${
                    selectedAssetFilter === sym
                      ? "bg-[var(--base-blue)] text-white"
                      : "bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--foreground)] border border-[var(--border)]"
                  }`}
                >
                  {sym === "all" ? "All Assets" : sym.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)] font-medium">Role:</span>
              {(["all", "taker", "lp"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRoleFilter(role)}
                  className={`px-2.5 py-1 rounded-lg font-semibold capitalize transition-colors cursor-pointer ${
                    selectedRoleFilter === role
                      ? "bg-[var(--base-blue)] text-white"
                      : "bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--foreground)] border border-[var(--border)]"
                  }`}
                >
                  {role === "all" ? "All Roles" : role === "taker" ? "Taker (Buyer)" : "LP (Seller)"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Positions List */}
      {isConnected && (
        <div className="flex flex-col gap-3.5">
          {loading && positions === null && (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 w-full animate-pulse rounded-xl bg-[var(--surface-raised)] border border-[var(--border)]" />
              ))}
            </div>
          )}

          {!loading && currentList.length === 0 && (
            <Card className="border-dashed p-8 text-center">
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                {activeTab === "active" ? "No Active Positions Found" : "No Position History"}
              </h3>
              <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto mt-1 mb-4">
                {activeTab === "active"
                  ? "You don't have any open options positions matching the current filters. Browse live market quotes on the Take page to open one."
                  : "You haven't executed or closed any options positions yet."}
              </p>
              {activeTab === "active" && (
                <Link
                  href="/"
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--base-blue)] px-4 text-xs font-bold text-white hover:bg-[var(--base-blue-hover)] transition-colors"
                >
                  Open New Position
                </Link>
              )}
            </Card>
          )}

          {currentList.map((pos) => (
            <PositionCard
              key={pos.positionId.toString()}
              position={pos}
              isClosing={closingId === pos.positionId}
              closeStatus={closingId === pos.positionId ? closeStatus : "idle"}
              onClose={() => handleClosePosition(pos)}
              onSettleLp={() => handleSettleLp(pos)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PositionCard({
  position,
  isClosing,
  closeStatus,
  onClose,
  onSettleLp,
}: {
  position: OwnedPosition & {
    status: "Active" | "Settled" | "Expired";
    isSettled: boolean;
    isExpired: boolean;
    isTakerProfit: boolean;
    livePrice: bigint;
    entryPriceVal: number;
    livePriceVal: number;
    assetSize: number;
    isItm: boolean;
    pnlUsd: number;
    pnlPct: number;
  };
  isClosing: boolean;
  closeStatus: "idle" | "signing" | "submitting" | "confirmed" | "error";
  onClose: () => void;
  onSettleLp: () => void;
}) {
  const assetSym = assetDisplaySymbol(position.economics.collateralAsset);
  const cp = getCounterparty(position.economics.lp);
  const isCall = position.economics.optionType === 0;

  // Format Position Name: "ASSET - Price Taken"
  const positionTitle = `${assetSym} ${isCall ? "CALL" : "PUT"} · $${position.entryPriceVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card className="p-4 sm:p-5 transition-all hover:border-[var(--border-strong)]">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-xs font-bold text-[var(--text-muted)]">
            #{position.positionId.toString()}
          </span>
          <h3 className="text-base font-extrabold text-[var(--foreground)] tracking-tight">
            {positionTitle}
          </h3>
          <Badge
            tone={isCall ? "emerald" : "amber"}
            tooltip={isCall ? "Call Option: gains value when price increases above entry price." : "Put Option: gains value when price drops below entry price."}
          >
            {isCall ? "CALL (Bullish)" : "PUT (Bearish)"}
          </Badge>
          <Badge
            tone={position.isOwner ? "blue" : "cyan"}
            tooltip={position.isOwner ? "You hold the NFT option position rights as the buyer (Taker)." : "You provided collateral liquidity for this contract as the LP."}
          >
            {position.isOwner ? "Taker" : "LP"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {position.status === "Active" ? (
            <Tooltip
              content={
                position.isItm
                  ? "In the Money: Live price exceeds strike condition. You can close early to lock in profits."
                  : "Out of the Money: Current oracle price has not crossed the strike threshold."
              }
            >
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold cursor-help ${
                position.isItm
                  ? "bg-[var(--emerald-bg)] text-[var(--emerald-text)] border border-[var(--emerald-border)]"
                  : "bg-[var(--surface-overlay)] text-[var(--text-muted)] border border-[var(--border)]"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${position.isItm ? "bg-[var(--emerald-text)] animate-pulse" : "bg-[var(--text-muted)]"}`} />
                {position.isItm ? "In the Money" : "Out of the Money"}
              </span>
            </Tooltip>
          ) : (
            <Badge
              tone={position.status === "Settled" ? "blue" : "amber"}
              tooltip={position.status === "Settled" ? "Position was exercised and settled on-chain." : "Position reached its expiry timestamp."}
            >
              {position.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] p-3.5 text-xs">
        <div>
          <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
            <span>Position Size</span>
            <InfoTooltip content="Underlying notional amount of the position." size={11} />
          </div>
          <div className="mt-0.5 font-mono text-sm font-bold text-[var(--foreground)]">
            {position.assetSize.toLocaleString(undefined, { maximumFractionDigits: 4 })} {assetSym}
          </div>
        </div>

        <div>
          <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
            <span>Price Taken / Live</span>
            <InfoTooltip content="Strike price locked at mint time vs current live Base oracle feed price." size={11} />
          </div>
          <div className="mt-0.5 font-mono text-sm font-bold text-[var(--foreground)]">
            ${position.entryPriceVal.toLocaleString(undefined, { maximumFractionDigits: 2 })} → ${position.livePriceVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>

        <div>
          <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
            <span>Profitability / PnL</span>
            <InfoTooltip content="Unrealized payoff calculated from live price difference multiplied by position units." size={11} />
          </div>
          <div className={`mt-0.5 font-mono text-sm font-bold ${
            position.pnlUsd > 0
              ? "text-[var(--emerald-text)]"
              : position.pnlUsd < 0
              ? "text-[var(--red-text)]"
              : "text-[var(--text-muted)]"
          }`}>
            {position.pnlUsd > 0
              ? `+$${position.pnlUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (+${position.pnlPct.toFixed(1)}%)`
              : position.pnlUsd < 0
              ? `-$${Math.abs(position.pnlUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${position.pnlPct.toFixed(1)}%)`
              : "$0.00 (0.0%)"}
          </div>
        </div>

        <div>
          <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
            <span>Counterparty</span>
            <InfoTooltip content="Liquidity provider or market maker backing this position." size={11} />
          </div>
          <div className="mt-0.5 font-semibold text-sm text-[var(--foreground)] truncate" title={position.economics.lp}>
            {cp.name}
          </div>
        </div>
      </div>

      {/* Footer / Action Controls */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <Tooltip content={`Exact expiration: ${formatExpiryDateHover(position.economics.expiry)} (UTC)`}>
            <span className="cursor-help transition-colors hover:text-[var(--foreground)]">
              <strong className="text-[var(--foreground)]">
                {formatExpiryCountdown(position.economics.expiry)}
              </strong>
            </span>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          {/* Taker Action: Instant Close Position */}
          {position.status === "Active" && position.isOwner && (
            position.isTakerProfit ? (
              <button
                type="button"
                onClick={onClose}
                disabled={!position.isItm || isClosing}
                className={`h-9 px-4 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
                  position.isItm
                    ? "bg-[var(--base-blue)] text-white hover:bg-[var(--base-blue-hover)]"
                    : "bg-[var(--surface-overlay)] text-[var(--text-disabled)] border border-[var(--border)] cursor-not-allowed"
                }`}
                title={position.isItm ? `Close and collect $${position.pnlUsd.toFixed(2)} profit` : "Position is currently out of the money"}
              >
                {isClosing ? (
                  <span>{closeStatus === "signing" ? "Confirm Signature..." : "Settling On-Chain..."}</span>
                ) : position.isItm ? (
                  <span>Close Position (+${position.pnlUsd.toFixed(2)})</span>
                ) : (
                  <span>Close (Unprofitable)</span>
                )}
              </button>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-overlay)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] border border-[var(--border)]"
                title="This contract uses ExpiryCondition and settles to LP at expiry."
              >
                Settles at Expiry
              </span>
            )
          )}

          {/* LP Action: Settle Expired */}
          {position.status === "Expired" && position.isLp && (
            <button
              type="button"
              onClick={onSettleLp}
              disabled={isClosing}
              className="h-9 px-4 rounded-lg bg-[var(--base-blue)] text-xs font-bold text-white hover:bg-[var(--base-blue-hover)] transition-all cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
            >
              {isClosing ? "Settling..." : "Reclaim Collateral (Expired)"}
            </button>
          )}

          {position.status === "Settled" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--base-blue-light)]">
              <CheckIcon size={14} /> Settled &amp; Paid
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
