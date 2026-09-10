import { type Address, type Hex, encodeAbiParameters, keccak256 } from "viem";
import { addresses } from "@/config/addresses";
import { ZERO_BYTES32 } from "./liquidityProfile";

// Mirrors src/types/ActionKind.sol exactly — order is the enum's uint8 encoding.
export enum ActionKind {
  SettleToTaker = 0,
  SettleToLp = 1,
  MutualUnwind = 2,
  SweepDust = 3,
  RawExecute = 4,
}

export interface EconomicsStruct {
  lp: Address;
  collateralAsset: Address;
  collateralDecimals: number;
  settlementAsset: Address;
  settlementDecimals: number;
  optionType: number;
  units: bigint;
  unitScalarNum: bigint;
  unitScalarDen: bigint;
  entryPrice: bigint;
  expiry: bigint;
  feeBps: number;
}

export interface PointersStruct {
  oracle: Address;
  venue: Address;
  arbiter: Address;
  condition: Address;
  routeId: Hex;
  maxPriceAge: number;
  slippageBps: number;
}

export interface ActionContextValue {
  account: Address;
  implementation: Address;
  homeChainId: bigint;
  positionManager: Address;
  positionId: bigint;
  accountState: bigint;
  signerEpoch: bigint;
  actionKind: ActionKind;
  params: Hex;
  deadline: bigint;
  economics: EconomicsStruct;
  pointers: PointersStruct;
}

// src/libraries/DigestLib.sol's ACTION_TYPEHASH domain/type — verified byte-for-byte
// against DigestLib.digest via a one-off Foundry cross-check (fixed example ctx, same
// digest both sides). Note the *account*, not PositionManager, is verifyingContract here —
// every position's account is its own EIP-712 domain (DigestLib's own NatSpec: computed
// fresh per call, deliberately not cached, since each ERC-6551 clone is a different
// verifyingContract sharing one implementation's bytecode).
export function actionDomain(account: Address) {
  return {
    name: "OptionCore",
    version: "1",
    chainId: addresses.chainId,
    verifyingContract: account,
  } as const;
}

export const actionTypes = {
  Action: [
    { name: "chainId", type: "uint256" },
    { name: "account", type: "address" },
    { name: "accountState", type: "uint256" },
    { name: "signerEpoch", type: "uint256" },
    { name: "actionKind", type: "uint8" },
    { name: "paramsHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function actionMessage(ctx: ActionContextValue) {
  return {
    chainId: BigInt(addresses.chainId),
    account: ctx.account,
    accountState: ctx.accountState,
    signerEpoch: ctx.signerEpoch,
    actionKind: ctx.actionKind,
    paramsHash: keccak256(ctx.params),
    deadline: ctx.deadline,
  };
}

// ---------------------------------------------------------------------------------------
// Per-action params encoding — src/types/ActionParams.sol. Field order matters (it's what
// abi.encode/abi.decode on the Solidity side agree on structurally, independent of names).
// ---------------------------------------------------------------------------------------

export function encodeSettleToTakerParams(p: {
  exitPrice: bigint;
  minAmountOut: bigint;
  minPayoutToTaker: bigint;
  swapDeadline: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      { name: "exitPrice", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "minPayoutToTaker", type: "uint256" },
      { name: "swapDeadline", type: "uint256" },
    ],
    [p.exitPrice, p.minAmountOut, p.minPayoutToTaker, p.swapDeadline],
  );
}

export function encodeMutualUnwindParams(p: { takerBps: number }): Hex {
  return encodeAbiParameters([{ name: "takerBps", type: "uint16" }], [p.takerBps]);
}

// SettleToLp has no params struct (src/types/ActionParams.sol's own note) — ctx.params
// must be empty for it.
export const EMPTY_PARAMS: Hex = "0x";

// ---------------------------------------------------------------------------------------
// Arbiter auto-approval (slot 2, no wallet signature needed): ConditionArbiter.
// isValidSignature decodes its `sig` argument as `abi.decode(sig, (ActionContext, bytes))`
// and re-derives+re-checks everything from the embedded `ctx` itself (never trusts the
// caller) — so this "signature" is really just the ctx re-stated, plus an opaque
// condition-specific `hint` (ICondition's own doc: e.g. a route hint; both ExpiryCondition
// and TakerProfitCondition ignore it, so `0x` is fine for both). Verified byte-for-byte
// against `abi.encode(ctx, hint)` via a one-off Foundry cross-check.
const ACTION_CONTEXT_ABI_TYPE = {
  type: "tuple",
  components: [
    { name: "account", type: "address" },
    { name: "implementation", type: "address" },
    { name: "homeChainId", type: "uint256" },
    { name: "positionManager", type: "address" },
    { name: "positionId", type: "uint256" },
    { name: "accountState", type: "uint256" },
    { name: "signerEpoch", type: "uint256" },
    { name: "actionKind", type: "uint8" },
    { name: "params", type: "bytes" },
    { name: "deadline", type: "uint256" },
    {
      name: "economics",
      type: "tuple",
      components: [
        { name: "lp", type: "address" },
        { name: "collateralAsset", type: "address" },
        { name: "collateralDecimals", type: "uint8" },
        { name: "settlementAsset", type: "address" },
        { name: "settlementDecimals", type: "uint8" },
        { name: "optionType", type: "uint8" },
        { name: "units", type: "uint256" },
        { name: "unitScalarNum", type: "uint256" },
        { name: "unitScalarDen", type: "uint256" },
        { name: "entryPrice", type: "uint256" },
        { name: "expiry", type: "uint64" },
        { name: "feeBps", type: "uint16" },
      ],
    },
    {
      name: "pointers",
      type: "tuple",
      components: [
        { name: "oracle", type: "address" },
        { name: "venue", type: "address" },
        { name: "arbiter", type: "address" },
        { name: "condition", type: "address" },
        { name: "routeId", type: "bytes32" },
        { name: "maxPriceAge", type: "uint32" },
        { name: "slippageBps", type: "uint16" },
      ],
    },
  ],
} as const;

export function encodeArbiterApproval(ctx: ActionContextValue, hint: Hex = "0x"): Hex {
  return encodeAbiParameters([ACTION_CONTEXT_ABI_TYPE, { name: "hint", type: "bytes" }], [ctx, hint]);
}

/**
 * Whether the arbiter can auto-approve `actionKind` given the position's wired
 * `pointers.condition`. Reflects actual on-chain behavior, not a simplification:
 * - `TakerProfitCondition.check` unconditionally does
 *   `abi.decode(ctx.params, (SettleToTakerParams))` — a 4-word struct. SettleToLp's empty
 *   params and MutualUnwind's 1-word params both fail to decode (revert -> BAD_VALUE via
 *   ConditionArbiter's try/catch), so this condition only ever automates SettleToTaker.
 * - `ExpiryCondition.check` ignores `ctx.params`/`actionKind` entirely — it only checks
 *   `block.timestamp >= ctx.economics.expiry` — so once expired, it will just as happily
 *   approve SettleToTaker as SettleToLp. Both are offered when this condition is wired.
 * - MutualUnwind is never arbiter-eligible regardless of condition (AuthzModule.policyFor
 *   excludes slot 2 from its eligible mask for that action kind) — a real threshold
 *   restriction, not a condition-shape one, so no condition ever changes this.
 */
export function arbiterCanAutomate(conditionAddress: Address, actionKind: ActionKind): boolean {
  if (actionKind === ActionKind.MutualUnwind) return false;
  if (conditionAddress.toLowerCase() === addresses.takerProfitCondition.toLowerCase()) {
    return actionKind === ActionKind.SettleToTaker;
  }
  if (conditionAddress.toLowerCase() === addresses.expiryCondition.toLowerCase()) {
    return actionKind === ActionKind.SettleToTaker || actionKind === ActionKind.SettleToLp;
  }
  return false;
}

export { ZERO_BYTES32 };
