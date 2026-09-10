import type { Address, Hex } from "viem";
import type { ActionContextValue, ActionKind } from "./actionContext";

// JSON round-trip for ActionContextValue (bigints as strings) plus the in-progress
// per-slot approvals, so a proposal can be exported/imported for out-of-band co-signing
// (no backend — see profileStore.ts's identical rationale for LiquidityProfile).
export interface SerializedActionContext {
  account: Address;
  implementation: Address;
  homeChainId: string;
  positionManager: Address;
  positionId: string;
  accountState: string;
  signerEpoch: string;
  actionKind: number;
  params: Hex;
  deadline: string;
  economics: {
    lp: Address;
    collateralAsset: Address;
    collateralDecimals: number;
    settlementAsset: Address;
    settlementDecimals: number;
    optionType: number;
    units: string;
    unitScalarNum: string;
    unitScalarDen: string;
    entryPrice: string;
    expiry: string;
    feeBps: number;
  };
  pointers: {
    oracle: Address;
    venue: Address;
    arbiter: Address;
    condition: Address;
    routeId: Hex;
    maxPriceAge: number;
    slippageBps: number;
  };
}

export interface ActionBundle {
  ctx: SerializedActionContext;
  approvals: Partial<Record<0 | 1 | 2, Hex>>;
}

export function serializeActionContext(ctx: ActionContextValue): SerializedActionContext {
  return {
    account: ctx.account,
    implementation: ctx.implementation,
    homeChainId: ctx.homeChainId.toString(),
    positionManager: ctx.positionManager,
    positionId: ctx.positionId.toString(),
    accountState: ctx.accountState.toString(),
    signerEpoch: ctx.signerEpoch.toString(),
    actionKind: ctx.actionKind,
    params: ctx.params,
    deadline: ctx.deadline.toString(),
    economics: {
      ...ctx.economics,
      units: ctx.economics.units.toString(),
      unitScalarNum: ctx.economics.unitScalarNum.toString(),
      unitScalarDen: ctx.economics.unitScalarDen.toString(),
      entryPrice: ctx.economics.entryPrice.toString(),
      expiry: ctx.economics.expiry.toString(),
    },
    pointers: { ...ctx.pointers },
  };
}

export function deserializeActionContext(raw: SerializedActionContext): ActionContextValue {
  return {
    account: raw.account,
    implementation: raw.implementation,
    homeChainId: BigInt(raw.homeChainId),
    positionManager: raw.positionManager,
    positionId: BigInt(raw.positionId),
    accountState: BigInt(raw.accountState),
    signerEpoch: BigInt(raw.signerEpoch),
    actionKind: raw.actionKind as ActionKind,
    params: raw.params,
    deadline: BigInt(raw.deadline),
    economics: {
      ...raw.economics,
      units: BigInt(raw.economics.units),
      unitScalarNum: BigInt(raw.economics.unitScalarNum),
      unitScalarDen: BigInt(raw.economics.unitScalarDen),
      entryPrice: BigInt(raw.economics.entryPrice),
      expiry: BigInt(raw.economics.expiry),
    },
    pointers: raw.pointers,
  };
}
