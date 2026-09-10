"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useConnection, useReadContracts, useSwitchChain } from "wagmi";
import type { Address, Hex } from "viem";
import { addresses } from "@/config/addresses";
import { targetChain } from "@/config/chain";
import { PositionManagerAbi } from "@/generated/abis/PositionManager";
import { LPRouterAbi } from "@/generated/abis/LPRouter";
import { listProfiles } from "@/lib/profileStore";
import { listQuotes } from "@/lib/quoteStore";
import type { SignedLiquidityProfile } from "@/lib/liquidityProfile";
import type { SignedBackerQuote } from "@/lib/backerQuote";
import { buildMarketEntries } from "@/lib/market";
import { ExecutionCockpit } from "@/components/market/ExecutionCockpit";
import { MarketActivityFeed } from "@/components/market/MarketActivityFeed";
import { ErrorBanner, PageHeader } from "@/components/ui";

const MarketChart = dynamic(() => import("@/components/market/MarketChart").then((m) => m.MarketChart), {
  ssr: false,
  loading: () => <div className="h-[560px] w-full animate-pulse rounded-xl bg-[var(--surface-raised)] border border-[var(--border)]" />,
});

const DEFAULT_DURATION_HOURS = 24;
const DEFAULT_DESIRED_UNITS = 10n; // 0.10 Underlying Asset

export default function Home() {
  const { address, isConnected, chainId } = useConnection();
  const { switchChain } = useSwitchChain();
  const [selectedAsset, setSelectedAsset] = useState<Address>(addresses.collateralAsset);
  const [duration, setDuration] = useState(DEFAULT_DURATION_HOURS);
  const [desiredUnits, setDesiredUnits] = useState(DEFAULT_DESIRED_UNITS);
  const [optionType, setOptionType] = useState<0 | 1>(0);

  const [allProfiles, setAllProfiles] = useState<SignedLiquidityProfile[]>([]);
  const [allQuotes, setAllQuotes] = useState<SignedBackerQuote[]>([]);
  
  useEffect(() => {
    listProfiles({ status: "active" }).then(setAllProfiles);
    listQuotes({ status: "active" }).then(setAllQuotes);
  }, []);

  const entries = useMemo(
    () => buildMarketEntries(allProfiles, allQuotes, selectedAsset),
    [allProfiles, allQuotes, selectedAsset],
  );

  const consumedReads = useReadContracts({
    contracts: entries.map((e) => ({
      address: e.kind === "profile" ? addresses.positionManager : addresses.lpRouter,
      abi: e.kind === "profile" ? PositionManagerAbi : LPRouterAbi,
      functionName: e.kind === "profile" ? "consumedUnits" : "consumedUnitsForQuote",
      args: [e.hash],
    })),
    query: { enabled: entries.length > 0, retry: false, staleTime: 15_000 },
  });

  const consumedByHash = useMemo(() => {
    const map: Record<Hex, bigint> = {};
    entries.forEach((e, i) => {
      const v = consumedReads.data?.[i]?.result as bigint | undefined;
      map[e.hash] = v ?? 0n;
    });
    return map;
  }, [entries, consumedReads.data]);

  function selectAsset(a: Address) {
    setSelectedAsset(a);
    setDuration(DEFAULT_DURATION_HOURS);
    setDesiredUnits(DEFAULT_DESIRED_UNITS);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Trade Options"
        description="Configure duration and units on the interactive depth chart. Collateral is staged in Uniswap v4 pools, earning AMM fees while uncommitted."
        tooltip="Select an underlying asset, configure duration and units on the depth chart, and take an option position backed by Uniswap v4 liquidity."
      />

      {!isConnected && (
        <div className="rounded-xl border border-dashed border-[var(--border-hover)] bg-[var(--surface-raised)] px-4 py-2.5 text-xs text-[var(--text-muted)] flex items-center justify-between gap-2">
          <span>
            <strong className="text-[var(--foreground)]">Wallet Disconnected</strong>
          </span>
        </div>
      )}

      {isConnected && chainId !== targetChain.id && (
        <div className="rounded-xl border border-[var(--amber-border)] bg-[var(--amber-bg)] px-4 py-2.5 text-xs text-[var(--amber-text)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--amber-text)] animate-ping" />
            <span>
              <strong>Wrong Network:</strong> Connected to chain {chainId}. Switch to {targetChain.name} to view your balances and execute trades.
            </span>
          </div>
          {switchChain && (
            <button
              type="button"
              onClick={() => switchChain({ chainId: targetChain.id })}
              className="rounded-lg bg-[var(--base-blue)] px-3 py-1 text-xs font-bold text-white hover:bg-[var(--base-blue-hover)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
            >
              Switch Network
            </button>
          )}
        </div>
      )}

      {consumedReads.isError && (
        <ErrorBanner message="RPC sync failed." />
      )}

      {/* Main Trading Workspace */}
      <div className="overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-3">
          <div className="border-[var(--border)] p-4 lg:col-span-2 lg:border-r">
            <MarketChart
              selectedAsset={selectedAsset}
              onSelectAsset={selectAsset}
              entries={entries}
              consumedByHash={consumedByHash}
              duration={duration}
              desiredUnits={desiredUnits}
              onDurationChange={setDuration}
              onDesiredUnitsChange={setDesiredUnits}
            />
          </div>
          <div className="flex flex-col divide-y divide-[var(--border)] border-t border-[var(--border)] lg:border-t-0">
            <div className="p-5">
              <ExecutionCockpit
                key={selectedAsset}
                selectedAsset={selectedAsset}
                entries={entries}
                consumedByHash={consumedByHash}
                duration={duration}
                onDurationChange={setDuration}
                desiredUnits={desiredUnits}
                onDesiredUnitsChange={setDesiredUnits}
                optionType={optionType}
                onOptionTypeChange={setOptionType}
                address={address}
              />
            </div>
            <div className="p-5">
              <MarketActivityFeed />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
