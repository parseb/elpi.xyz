import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseEventLogs, type Address } from "viem";
import { addresses } from "@/config/addresses";
import { isDev } from "@/config/chain";
import { PositionManagerAbi } from "@/generated/abis/PositionManager";
import { assetDisplaySymbol, formatAsset } from "@/lib/assetLabels";
import { Badge, InfoTooltip, label as labelClass } from "@/components/ui";
import { RefreshIcon } from "@/components/icons";

interface ActivityRow {
  positionId: bigint;
  account: Address;
  units: bigint;
  optionType: number;
  collateralAsset: Address;
  blockNumber: bigint;
}

const POLL_MS = 20000;
const MAX_ROWS = 20;

export function MarketActivityFeed() {
  const publicClient = usePublicClient();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchActivity = useCallback(async () => {
    if (!publicClient) return;
    setLoading(true);
    try {
      let fromBlock = 0n;
      if (!isDev) {
        try {
          const currentBlock = await publicClient.getBlockNumber();
          fromBlock = currentBlock > 10000n ? currentBlock - 10000n : 0n;
        } catch {
          fromBlock = 0n;
        }
      }

      const logs = await publicClient.getContractEvents({
        address: addresses.positionManager,
        abi: PositionManagerAbi,
        eventName: "PositionMinted",
        fromBlock,
        toBlock: "latest",
      });
      const parsed = parseEventLogs({ abi: PositionManagerAbi, eventName: "PositionMinted", logs });
      const next = parsed
        .map((e) => ({
          positionId: e.args.positionId,
          account: e.args.account,
          units: e.args.economics.units,
          optionType: e.args.economics.optionType,
          collateralAsset: e.args.economics.collateralAsset,
          blockNumber: e.blockNumber ?? 0n,
        }))
        .sort((a, b) => Number(b.blockNumber - a.blockNumber) || Number(b.positionId - a.positionId))
        .slice(0, MAX_ROWS);
      setRows(next);
    } catch (e) {
      console.debug("MarketActivityFeed poll skipped:", e);
      setRows((prev) => (prev === null ? [] : prev));
    } finally {
      setLoading(false);
    }
  }, [publicClient]);

  useEffect(() => {
    fetchActivity();
    const id = setInterval(fetchActivity, POLL_MS);
    return () => clearInterval(id);
  }, [fetchActivity]);

  return (
    <section aria-label="Market Activity Feed">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className={labelClass}>Activity</h2>
          <InfoTooltip content="Live on-chain mints and settlement executions broadcast on Base." size={12} />
        </div>
        <button
          type="button"
          onClick={fetchActivity}
          disabled={loading}
          aria-label="Refresh activity feed"
          className="text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh activity feed"
        >
          <RefreshIcon size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {rows === null && <p className="mt-2 text-xs text-[var(--text-muted)]">Loading...</p>}
      {rows && rows.length === 0 && <p className="mt-2 text-xs text-[var(--text-muted)]">No Activity</p>}
      <div role="feed" aria-busy={rows === null} className="mt-2.5 flex flex-col gap-2">
        {rows?.map((r) => (
          <article key={r.positionId.toString()} className="flex items-center justify-between text-xs text-[var(--foreground)]">
            <span className="font-mono text-[var(--text-muted)]" title={r.account}>
              {r.account.slice(0, 6)}...{r.account.slice(-4)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono font-semibold">#{r.positionId.toString()}</span>
              <span className="font-mono tabular-nums">{formatAsset(r.units, assetDisplaySymbol(r.collateralAsset))}</span>
              <Badge
                tone={r.optionType === 0 ? "emerald" : "amber"}
                tooltip={r.optionType === 0 ? "Call option (bullish)" : "Put option (bearish)"}
              >
                {r.optionType === 0 ? "CALL" : "PUT"}
              </Badge>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

