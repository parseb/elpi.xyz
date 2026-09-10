"use client";

import { use, useEffect, useMemo, useState } from "react";
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
import { Badge, Card, ErrorBanner, InfoTooltip, PageHeader, Tooltip } from "@/components/ui";
import { CheckIcon } from "@/components/icons";
import { assetDisplaySymbol, assetSymbol, formatExpiryCountdown, formatExpiryDateHover, unitsToAsset } from "@/lib/assetLabels";
import { getCounterparty } from "@/lib/counterparties";

export default function PositionDetailPage(props: PageProps<"/positions/[id]">) {
  const { id } = use(props.params);
  const positionId = BigInt(id);
  const { address } = useConnection();
  const publicClient = usePublicClient();

  const [data, setData] = useState<{
    account: Address;
    owner: Address;
    economics: EconomicsStruct;
    pointers: PointersStruct;
  } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [isClosing, setIsClosing] = useState(false);
  const [closeStatus, setCloseStatus] = useState<"idle" | "signing" | "submitting" | "confirmed" | "error">("idle");
  const [closeError, setCloseError] = useState<string | null>(null);

  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        let fromBlock = 0n;
        if (!isDev) {
          try {
            const currentBlock = await publicClient.getBlockNumber();
            fromBlock = currentBlock > 20000n ? currentBlock - 20000n : 0n;
          } catch {
            fromBlock = 0n;
          }
        }

        const logs = await publicClient.getContractEvents({
          address: addresses.positionManager,
          abi: PositionManagerAbi,
          eventName: "PositionMinted",
          args: { positionId },
          fromBlock,
          toBlock: "latest",
        });
        const parsed = parseEventLogs({ abi: PositionManagerAbi, eventName: "PositionMinted", logs });
        const event = parsed[0];
        if (cancelled) return;
        if (!event) {
          setNotFound(true);
          return;
        }

        let owner = event.args.economics.lp as Address;
        try {
          owner = await publicClient.readContract({
            address: addresses.positionManager,
            abi: PositionManagerAbi,
            functionName: "ownerOf",
            args: [positionId],
          });
        } catch {
          // ignore
        }

        setData({
          account: event.args.account,
          owner,
          economics: event.args.economics as EconomicsStruct,
          pointers: event.args.pointers as PointersStruct,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, positionId, retryTick]);

  const liveReads = useReadContracts({
    contracts: [
      {
        address: data?.account ?? "0x0000000000000000000000000000000000000000",
        abi: PositionAccountAbi,
        functionName: "accountState",
      },
      {
        address: data?.pointers.oracle ?? addresses.priceOracle,
        abi: MockPriceOracleAbi,
        functionName: "price",
        args: data ? [data.economics.collateralAsset, data.economics.settlementAsset] : undefined,
      },
    ],
    query: { enabled: !!data },
  });

  const accountState = liveReads.data?.[0]?.result as bigint | undefined;
  const livePriceTuple = liveReads.data?.[1]?.result as readonly [bigint, bigint] | undefined;
  const livePrice = livePriceTuple ? livePriceTuple[0] : (data ? data.economics.entryPrice : 0n);

  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const isSettled = accountState !== undefined && accountState > 0n;
  const isExpired = data ? nowSec >= Number(data.economics.expiry) : false;
  const isOwner = address && data ? address.toLowerCase() === data.owner.toLowerCase() : false;

  const status = isSettled ? "Settled" : isExpired ? "Expired" : "Active";

  const metrics = useMemo(() => {
    if (!data) return null;
    const entryPriceVal = Number(formatUnits(data.economics.entryPrice, 18));
    const livePriceVal = Number(formatUnits(livePrice, 18));
    const assetSize = unitsToAsset(data.economics.units);
    const isCall = data.economics.optionType === 0;

    let isItm = false;
    let pnlUsd = 0;
    let pnlPct = 0;

    if (isCall) {
      isItm = livePriceVal > entryPriceVal;
      pnlUsd = (livePriceVal - entryPriceVal) * assetSize;
      pnlPct = entryPriceVal > 0 ? ((livePriceVal - entryPriceVal) / entryPriceVal) * 100 : 0;
    } else {
      isItm = livePriceVal < entryPriceVal;
      pnlUsd = (entryPriceVal - livePriceVal) * assetSize;
      pnlPct = entryPriceVal > 0 ? ((entryPriceVal - livePriceVal) / entryPriceVal) * 100 : 0;
    }

    const isTakerProfit = true;

    return {
      entryPriceVal,
      livePriceVal,
      assetSize,
      isCall,
      isItm,
      isTakerProfit,
      pnlUsd,
      pnlPct,
    };
  }, [data, livePrice]);

  async function handleClosePosition() {
    if (!publicClient || !address || !data || !metrics) return;
    setIsClosing(true);
    setCloseStatus("signing");
    setCloseError(null);

    try {
      const chainNow = await publicClient.getBlock().then((b) => b.timestamp);
      const [accState, signerEpoch, oracleRes] = await Promise.all([
        publicClient.readContract({
          address: data.account,
          abi: PositionAccountAbi,
          functionName: "accountState",
        }),
        publicClient.readContract({
          address: addresses.positionManager,
          abi: PositionManagerAbi,
          functionName: "signerEpochOf",
          args: [positionId],
        }),
        publicClient.readContract({
          address: data.pointers.oracle,
          abi: MockPriceOracleAbi,
          functionName: "price",
          args: [data.economics.collateralAsset, data.economics.settlementAsset],
        }),
      ]);

      const currentLivePrice = oracleRes[0];
      const updatedAt = oracleRes[1];

      // Pre-flight check: not already settled
      if (accState > 0n) {
        throw new Error("This position has already been settled on-chain.");
      }

      // Pre-flight check: strict on-chain profitability
      const isCall = data.economics.optionType === 0;
      const signedPnl = isCall
        ? currentLivePrice - data.economics.entryPrice
        : data.economics.entryPrice - currentLivePrice;

      if (signedPnl <= 0n) {
        throw new Error(
          `Position is not profitable at live oracle price ($${Number(formatUnits(currentLivePrice, 18)).toFixed(2)} vs entry $${Number(formatUnits(data.economics.entryPrice, 18)).toFixed(2)}). Options contracts require positive PnL to exercise.`,
        );
      }

      // Pre-flight check: oracle freshness
      if (chainNow > updatedAt && chainNow - updatedAt > BigInt(data.pointers.maxPriceAge)) {
        throw new Error(
          `Oracle price is stale (age ${Number(chainNow - updatedAt)}s exceeds max ${data.pointers.maxPriceAge}s). Please refresh or update the oracle feed.`,
        );
      }

      const params = encodeSettleToTakerParams({
        exitPrice: currentLivePrice,
        minAmountOut: 0n,
        minPayoutToTaker: 0n,
        swapDeadline: chainNow + 3600n,
      });

      const ctx: ActionContextValue = {
        account: data.account,
        implementation: addresses.positionAccountImplementation,
        homeChainId: BigInt(addresses.chainId),
        positionManager: addresses.positionManager,
        positionId,
        accountState: accState,
        signerEpoch,
        actionKind: ActionKind.SettleToTaker,
        params,
        deadline: chainNow + 3600n,
        economics: data.economics,
        pointers: data.pointers,
      };

      const takerSignature = await signTypedDataAsync({
        domain: actionDomain(data.account),
        types: actionTypes,
        primaryType: "Action",
        message: actionMessage(ctx),
      });

      const arbiterApproval = encodeArbiterApproval(ctx);
      setCloseStatus("submitting");

      const hash = await writeContractAsync({
        address: data.account,
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
      setRetryTick((t) => t + 1);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : String(err));
      setCloseStatus("error");
    } finally {
      setIsClosing(false);
    }
  }

  const assetSym = data ? assetDisplaySymbol(data.economics.collateralAsset) : "ETH";
  const cp = data ? getCounterparty(data.economics.lp) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link
          href="/positions"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--base-blue-light)] hover:underline"
        >
          ← Back to Portfolio
        </Link>
        <span className="font-mono text-xs text-[var(--text-muted)]">Position #{id}</span>
      </div>

      {error && <ErrorBanner message={`Failed to load position: ${error}`} onRetry={() => setRetryTick((n) => n + 1)} />}
      {notFound && !error && (
        <ErrorBanner message={`No position contract found for ID #${id}.`} />
      )}

      {closeError && (
        <ErrorBanner message={`Failed to settle position: ${closeError}`} onRetry={() => setCloseError(null)} />
      )}
      {closeStatus === "confirmed" && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--emerald-border)] bg-[var(--emerald-bg)] p-3.5 text-xs font-bold text-[var(--emerald-text)]">
          <CheckIcon size={16} />
          <span>Position successfully closed and profit settled to your wallet!</span>
        </div>
      )}

      {data && metrics && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-extrabold text-[var(--foreground)] tracking-tight">
                {assetSym} {metrics.isCall ? "CALL" : "PUT"} · ${metrics.entryPriceVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h1>
              <Badge
                tone={metrics.isCall ? "emerald" : "amber"}
                tooltip={metrics.isCall ? "Call option: gains value when spot price rises above entry." : "Put option: gains value when spot price drops below entry."}
              >
                {metrics.isCall ? "CALL (Bullish)" : "PUT (Bearish)"}
              </Badge>
              <Badge
                tone={isOwner ? "blue" : "cyan"}
                tooltip={isOwner ? "Connected wallet is the NFT owner (Buyer / Taker)." : "Connected wallet is the Liquidity Provider."}
              >
                {isOwner ? "Taker" : "LP"}
              </Badge>
            </div>

            <div>
              {status === "Active" ? (
                <Tooltip
                  content={
                    metrics.isItm
                      ? "In the Money: Live oracle price satisfies the strike profit condition."
                      : "Out of the Money: Current oracle price is below the profitable threshold."
                  }
                >
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold cursor-help ${
                    metrics.isItm
                      ? "bg-[var(--emerald-bg)] text-[var(--emerald-text)] border border-[var(--emerald-border)]"
                      : "bg-[var(--surface-overlay)] text-[var(--text-muted)] border border-[var(--border)]"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${metrics.isItm ? "bg-[var(--emerald-text)] animate-pulse" : "bg-[var(--text-muted)]"}`} />
                    {metrics.isItm ? "In the Money" : "Out of the Money"}
                  </span>
                </Tooltip>
              ) : (
                <Badge
                  tone={status === "Settled" ? "blue" : "amber"}
                  tooltip={status === "Settled" ? "Position was executed and profit settled on-chain." : "Position contract reached its expiration timestamp."}
                >
                  {status}
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] p-4 text-xs">
            <div>
              <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
                <span>Position Size</span>
                <InfoTooltip content="Total notional units of underlying asset locked in this position." size={11} />
              </div>
              <div className="mt-0.5 font-mono text-base font-bold text-[var(--foreground)]">
                {metrics.assetSize} {assetSym}
              </div>
            </div>

            <div>
              <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
                <span>Entry Price → Live</span>
                <InfoTooltip content="Strike price recorded at mint time versus the latest oracle spot price." size={11} />
              </div>
              <div className="mt-0.5 font-mono text-base font-bold text-[var(--foreground)]">
                ${metrics.entryPriceVal.toFixed(2)} → ${metrics.livePriceVal.toFixed(2)}
              </div>
            </div>

            <div>
              <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
                <span>Unrealized PnL</span>
                <InfoTooltip content="Payoff calculated from live price difference multiplied by position units." size={11} />
              </div>
              <div className={`mt-0.5 font-mono text-base font-bold ${
                metrics.pnlUsd > 0
                  ? "text-[var(--emerald-text)]"
                  : metrics.pnlUsd < 0
                  ? "text-[var(--red-text)]"
                  : "text-[var(--text-muted)]"
              }`}>
                {metrics.pnlUsd > 0
                  ? `+$${metrics.pnlUsd.toFixed(2)} (+${metrics.pnlPct.toFixed(1)}%)`
                  : metrics.pnlUsd < 0
                  ? `-$${Math.abs(metrics.pnlUsd).toFixed(2)} (${metrics.pnlPct.toFixed(1)}%)`
                  : "$0.00 (0.0%)"}
              </div>
            </div>

            <div>
              <div className="text-[var(--text-muted)] font-medium flex items-center gap-1">
                <span>Counterparty</span>
                <InfoTooltip content="Liquidity provider or market maker backing this contract." size={11} />
              </div>
              <div className="mt-0.5 font-semibold text-sm text-[var(--foreground)] truncate" title={data.economics.lp}>
                {cp?.name}
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between pt-2 border-t border-[var(--border)]">
            <div className="text-xs text-[var(--text-muted)]">
              {data && (
                <Tooltip content={`Exact expiration: ${formatExpiryDateHover(data.economics.expiry)} (UTC)`}>
                  <span className="cursor-help transition-colors hover:text-[var(--foreground)]">
                    <strong className="text-[var(--foreground)]">
                      {formatExpiryCountdown(data.economics.expiry)}
                    </strong>
                  </span>
                </Tooltip>
              )}
            </div>

            <div>
              {status === "Active" && isOwner && (
                metrics.isTakerProfit ? (
                  <button
                    type="button"
                    onClick={handleClosePosition}
                    disabled={!metrics.isItm || isClosing}
                    className={`h-10 px-5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs ${
                      metrics.isItm
                        ? "bg-[var(--base-blue)] text-white hover:bg-[var(--base-blue-hover)]"
                        : "bg-[var(--surface-overlay)] text-[var(--text-disabled)] border border-[var(--border)] cursor-not-allowed"
                    }`}
                  >
                    {isClosing ? (
                      <span>{closeStatus === "signing" ? "Confirm in Wallet..." : "Settling On-Chain..."}</span>
                    ) : metrics.isItm ? (
                      <span>Close Position (+${metrics.pnlUsd.toFixed(2)})</span>
                    ) : (
                      <span>Close (Unprofitable)</span>
                    )}
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-overlay)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] border border-[var(--border)]"
                    title="This contract uses ExpiryCondition and settles to LP at expiry."
                  >
                    Settles at Expiry
                  </span>
                )
              )}

              {status === "Settled" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--base-blue-light)]">
                  <CheckIcon size={14} /> Settled &amp; Paid
                </span>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
