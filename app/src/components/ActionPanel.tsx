"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import {
  useConnection,
  usePublicClient,
  useReadContracts,
  useSignTypedData,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { addresses } from "@/config/addresses";
import { PositionAccountAbi } from "@/generated/abis/PositionAccount";
import { PositionManagerAbi } from "@/generated/abis/PositionManager";
import { MockPriceOracleAbi } from "@/generated/abis/MockPriceOracle";
import {
  ActionKind,
  EMPTY_PARAMS,
  actionDomain,
  actionMessage,
  actionTypes,
  arbiterCanAutomate,
  encodeArbiterApproval,
  encodeMutualUnwindParams,
  encodeSettleToTakerParams,
  type ActionContextValue,
  type EconomicsStruct,
  type PointersStruct,
} from "@/lib/actionContext";
import {
  deserializeActionContext,
  serializeActionContext,
  type ActionBundle,
} from "@/lib/actionContext.serialize";
import { Button, ErrorBanner, inputClass } from "@/components/ui";

export function ActionPanel({
  actionKind,
  account,
  positionId,
  economics,
  pointers,
}: {
  actionKind: ActionKind;
  account: Address;
  positionId: bigint;
  economics: EconomicsStruct;
  pointers: PointersStruct;
}) {
  const { address } = useConnection();
  const publicClient = usePublicClient();

  // Deadlines must be derived from the chain's own clock, not wall time - on Anvil that
  // clock is routinely fast-forwarded (evm_increaseTime) to test expiry logic, and a
  // wall-time deadline can already be "in the past" relative to a chain that's ahead of
  // real time. Confirmed the hard way: a first version of this used Date.now() and every
  // signed action reverted with AuthzModule's DeadlineExpired the moment the devnet clock
  // had been advanced past real time.
  const [chainNow, setChainNow] = useState<bigint | null>(null);
  useEffect(() => {
    if (!publicClient) return;
    publicClient.getBlock().then((b) => setChainNow(b.timestamp));
  }, [publicClient]);

  const live = useReadContracts({
    contracts: [
      { address: account, abi: PositionAccountAbi, functionName: "accountState" },
      { address: addresses.positionManager, abi: PositionManagerAbi, functionName: "signerEpochOf", args: [positionId] },
      { address: addresses.positionManager, abi: PositionManagerAbi, functionName: "ownerOf", args: [positionId] },
      {
        address: pointers.oracle,
        abi: MockPriceOracleAbi,
        functionName: "price",
        args: [economics.collateralAsset, economics.settlementAsset],
      },
    ],
  });

  const accountState = live.data?.[0]?.result as bigint | undefined;
  const liveSignerEpoch = live.data?.[1]?.result as bigint | undefined;
  const taker = live.data?.[2]?.result as Address | undefined;
  const livePrice = live.data?.[3]?.result as readonly [bigint, bigint] | undefined;

  // Action-specific inputs. deadline/swapDeadline are "user override, or empty for
  // default" - the default (chain time + 1h) is a derived value, not seeded via an effect,
  // so there's no synchronous setState-in-effect (the render-time derivation below covers
  // both the displayed value and what prepare() actually uses).
  const [exitPrice, setExitPrice] = useState("");
  const [minAmountOut, setMinAmountOut] = useState("0");
  const [minPayoutToTaker, setMinPayoutToTaker] = useState("0");
  const [swapDeadline, setSwapDeadline] = useState("");
  const [takerBps, setTakerBps] = useState("5000");
  const [deadline, setDeadline] = useState("");

  const defaultDeadline = chainNow !== null ? (chainNow + 3600n).toString() : "";
  const effectiveDeadline = deadline || defaultDeadline;
  const effectiveSwapDeadline = swapDeadline || defaultDeadline;

  const [prepared, setPrepared] = useState<ActionContextValue | null>(null);
  const [approvals, setApprovals] = useState<Partial<Record<0 | 1 | 2, Hex>>>({});
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sign = useSignTypedData();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data, query: { enabled: !!write.data } });

  const canAutomate = arbiterCanAutomate(pointers.condition, actionKind);
  const filledSlots = Object.keys(approvals).length;

  function prepare() {
    setError(null);
    if (accountState === undefined || liveSignerEpoch === undefined) {
      setError("Still loading live account state - try again in a moment.");
      return;
    }
    if (effectiveDeadline === "" || (actionKind === ActionKind.SettleToTaker && effectiveSwapDeadline === "")) {
      setError("Still loading the chain's current time to seed deadline defaults - try again in a moment.");
      return;
    }
    let params: Hex = EMPTY_PARAMS;
    if (actionKind === ActionKind.SettleToTaker) {
      params = encodeSettleToTakerParams({
        exitPrice: BigInt(exitPrice || (livePrice ? livePrice[0].toString() : "0")),
        minAmountOut: BigInt(minAmountOut),
        minPayoutToTaker: BigInt(minPayoutToTaker),
        swapDeadline: BigInt(effectiveSwapDeadline),
      });
    } else if (actionKind === ActionKind.MutualUnwind) {
      params = encodeMutualUnwindParams({ takerBps: Number(takerBps) });
    }

    const ctx: ActionContextValue = {
      account,
      implementation: addresses.positionAccountImplementation,
      homeChainId: BigInt(addresses.chainId),
      positionManager: addresses.positionManager,
      positionId,
      accountState,
      signerEpoch: liveSignerEpoch,
      actionKind,
      params,
      deadline: BigInt(effectiveDeadline),
      economics,
      pointers,
    };
    setPrepared(ctx);
    setApprovals({});
  }

  function reset() {
    setPrepared(null);
    setApprovals({});
    setError(null);
  }

  async function signSlot(slot: 0 | 1) {
    if (!prepared) return;
    setError(null);
    try {
      const signature = await sign.signTypedDataAsync({
        domain: actionDomain(prepared.account),
        types: actionTypes,
        primaryType: "Action",
        message: actionMessage(prepared),
      });
      setApprovals((prev) => ({ ...prev, [slot]: signature }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function autoApproveArbiter() {
    if (!prepared) return;
    setApprovals((prev) => ({ ...prev, 2: encodeArbiterApproval(prepared) }));
  }

  const exportJson = useMemo(() => {
    if (!prepared) return null;
    const bundle: ActionBundle = { ctx: serializeActionContext(prepared), approvals };
    return JSON.stringify(bundle, null, 2);
  }, [prepared, approvals]);

  function importBundle() {
    setError(null);
    try {
      const bundle = JSON.parse(importText) as ActionBundle;
      setPrepared(deserializeActionContext(bundle.ctx));
      setApprovals(bundle.approvals);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit() {
    if (!prepared) return;
    setError(null);
    const approvalArray = (Object.entries(approvals) as [string, Hex][])
      .map(([slot, signature]) => ({ slot: Number(slot), signature }))
      .sort((a, b) => a.slot - b.slot);
    const fn =
      actionKind === ActionKind.SettleToTaker
        ? "settleToTaker"
        : actionKind === ActionKind.SettleToLp
          ? "settleToLp"
          : "mutualUnwind";
    try {
      await write.writeContractAsync({
        address: prepared.account,
        abi: PositionAccountAbi,
        functionName: fn,
        args: [prepared, approvalArray],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const isLp = address && economics.lp.toLowerCase() === address.toLowerCase();
  const isTaker = address && taker && taker.toLowerCase() === address.toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      {!prepared && (
        <div className="flex flex-col gap-3">
          {actionKind === ActionKind.SettleToTaker && (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                Only succeeds if the account independently re-verifies profitability from the
                live oracle price (§ PositionAccount._requireProfitable) - exitPrice only
                matters for the arbiter-automated path&apos;s slippage check.
              </p>
              <TextField
                label={`Exit price (1e18, live = ${livePrice ? livePrice[0].toString() : "loading..."})`}
                value={exitPrice}
                onChange={setExitPrice}
                placeholder={livePrice ? livePrice[0].toString() : ""}
              />
              <TextField label="Min amount out (venue swap floor)" value={minAmountOut} onChange={setMinAmountOut} />
              <TextField label="Min payout to taker (settlement-asset units)" value={minPayoutToTaker} onChange={setMinPayoutToTaker} />
              <TextField
                label="Swap deadline (unix seconds, defaults to chain time + 1h)"
                value={swapDeadline}
                onChange={setSwapDeadline}
                placeholder={defaultDeadline}
              />
            </>
          )}
          {actionKind === ActionKind.MutualUnwind && (
            <TextField label="Taker Bps (0–10000)" value={takerBps} onChange={setTakerBps} />
          )}
          {actionKind === ActionKind.SettleToLp && (
            <p className="text-xs text-[var(--text-muted)]">
              Settles upon expiration (<code>block.timestamp &gt;= expiry</code>).
            </p>
          )}
          <TextField
            label="Deadline (seconds)"
            value={deadline}
            onChange={setDeadline}
            placeholder={defaultDeadline}
          />
          <Button
            variant="primary"
            onClick={prepare}
            className="self-start"
          >
            Prepare Signatures
          </Button>

          <div className="mt-2 border-t border-[var(--border)] pt-3">
            <p className="mb-1.5 text-xs font-semibold text-[var(--text-muted)]">Import Proposal</p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={3}
              placeholder="Paste JSON"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 font-mono text-xs text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:border-[var(--base-blue)] focus:outline-none"
            />
            <Button
              variant="secondary"
              onClick={importBundle}
              className="mt-2 text-xs"
            >
              Load Proposal
            </Button>
          </div>
        </div>
      )}

      {prepared && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 font-mono text-xs text-[var(--text-muted)]">
            Signatures: {filledSlots}/2 Collected
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SlotButton
              label="Sign LP (0)"
              disabled={!isLp}
              filled={!!approvals[0]}
              onClick={() => signSlot(0)}
            />
            <SlotButton
              label="Sign Taker (1)"
              disabled={!isTaker}
              filled={!!approvals[1]}
              onClick={() => signSlot(1)}
            />
            {actionKind !== ActionKind.MutualUnwind && (
              <SlotButton
                label="Arbiter (2)"
                disabled={!canAutomate}
                filled={!!approvals[2]}
                onClick={autoApproveArbiter}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              onClick={submit}
              disabled={filledSlots < 2 || write.isPending || receipt.isLoading}
            >
              {write.isPending || receipt.isLoading ? "Submitting..." : "Submit"}
            </Button>
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
          </div>

          {receipt.isSuccess && <p role="status" className="text-xs text-[var(--emerald-text)] font-bold">Confirmed</p>}
          {error && <ErrorBanner message={error} />}

          {exportJson && (
            <div className="mt-2">
              <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">Proposal JSON</p>
              <textarea
                readOnly
                value={exportJson}
                rows={4}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 font-mono text-xs text-[var(--foreground)]"
              />
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(exportJson)}
                className="mt-2 text-xs"
              >
                Copy JSON
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-[var(--text-muted)]">{label}</span>
      <input
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SlotButton({
  label,
  disabled,
  filled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  filled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || filled}
      onClick={onClick}
      className={`min-h-[44px] rounded-xl border px-3.5 py-2.5 text-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
        filled
          ? "border-[var(--emerald-border)] bg-[var(--emerald-bg)] text-[var(--emerald-text)] font-bold"
          : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-raised)]"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {filled ? "Signed" : label}
    </button>
  );
}

