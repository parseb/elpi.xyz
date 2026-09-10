import { formatUnits, type Address, type Hex } from "viem";
import { assetDecimals } from "./assetLabels";
import { hashBackerQuote, type SignedBackerQuote } from "./backerQuote";
import { hashLiquidityProfile, type SignedLiquidityProfile } from "./liquidityProfile";

/// Unifies solo LiquidityProfiles and router BackerQuotes into one pool so the market chart
/// never needs a kind-switch except when it matters on-chain: each carries its own EIP-712
/// digest (the same one PositionManager.consumedUnits / LPRouter.consumedUnitsForQuote are
/// keyed by) so remaining capacity can be read the same way regardless of kind.
export type MarketEntry =
  | { kind: "profile"; data: SignedLiquidityProfile; hash: Hex }
  | { kind: "quote"; data: SignedBackerQuote; hash: Hex };

// Router matchAndMint's own hard cap (ILPRouter.sol MAX_BACKERS) — a selection needing more
// router quotes than this can only ever partially fill via the router step.
const MAX_ROUTER_BACKERS = 8;

export function buildMarketEntries(
  profiles: SignedLiquidityProfile[],
  quotes: SignedBackerQuote[],
  selectedAsset: Address,
): MarketEntry[] {
  const asset = selectedAsset.toLowerCase();
  const profileEntries: MarketEntry[] = profiles
    .filter((p) => p.collateralAsset.toLowerCase() === asset)
    .map((p) => ({ kind: "profile", data: p, hash: hashLiquidityProfile(p) }));
  const quoteEntries: MarketEntry[] = quotes
    .filter((q) => q.collateralAsset.toLowerCase() === asset)
    .map((q) => ({ kind: "quote", data: q, hash: hashBackerQuote(q) }));
  return [...profileEntries, ...quoteEntries];
}

export function entryCapacity(e: MarketEntry): bigint {
  return e.kind === "profile" ? e.data.totalUnits : e.data.maxUnits;
}

export function entryProvider(e: MarketEntry): Address {
  return e.kind === "profile" ? e.data.lp : e.data.backer;
}

export function remainingUnits(e: MarketEntry, consumedByHash: Record<Hex, bigint>): bigint {
  const capacity = entryCapacity(e);
  const consumed = consumedByHash[e.hash] ?? 0n;
  return capacity > consumed ? capacity - consumed : 0n;
}

/// pricePerUnitPerHour is signed on-chain in raw settlement-asset base units (see
/// PositionManager.sol's premium formula, which applies no further decimal scaling) —
/// every display site converts to a human $/hr rate through here, keyed by the entry's own
/// settlementAsset decimals, rather than assuming a fixed scale.
export function entryHumanRate(e: MarketEntry): number {
  return Number(formatUnits(e.data.pricePerUnitPerHour, assetDecimals(e.data.settlementAsset)));
}

export interface AllocationRow {
  entry: MarketEntry;
  remaining: bigint;
  units: bigint;
}

export interface AllocationResult {
  rows: AllocationRow[];
  totalUnits: bigint;
  premium: bigint;
  effectiveRate: bigint;
  shortfall: bigint;
}

/// Cheapest-first greedy allocation across a mixed pool of solo profiles and router quotes —
/// generalizes mint-router/page.tsx's findMatches(). No price ceiling: the taker no longer
/// selects a max-acceptable rate directly (that was the old brush-selection's price axis,
/// replaced by a duration slider + a units slider) — cheapest-first ordering alone already
/// gives the taker the best available rate for whatever it does end up finding.
/// Solo-profile rows each become their own independent PositionManager.mint call later
/// (splitQueue), so they carry no cross-entry terms restriction; router-quote rows all end
/// up combined in one LPRouter.matchAndMint call, which reverts (QuoteTermsMismatch) unless
/// every combined quote shares every routing term — so quote candidates are filtered down to
/// the subset matching whichever eligible quote is encountered first, exactly like the
/// existing single-page algorithm's `reference`.
export function allocate(
  entries: MarketEntry[],
  consumedByHash: Record<Hex, bigint>,
  desiredUnits: bigint,
  duration: number,
  optionType: 0 | 1,
): AllocationResult {
  const durationOk = (e: MarketEntry) => duration >= e.data.minHours && duration <= e.data.maxHours;
  const optionTypeOk = (e: MarketEntry) => e.data.supportsOptionType === 2 || e.data.supportsOptionType === optionType;

  let candidates = entries
    .map((entry) => ({ entry, remaining: remainingUnits(entry, consumedByHash) }))
    .filter(({ entry, remaining }) => remaining > 0n && durationOk(entry) && optionTypeOk(entry));

  const reference = candidates.find(({ entry }) => entry.kind === "quote")?.entry;
  const quoteTermsMatch = (e: MarketEntry): boolean => {
    if (!reference) return true;
    const a = e.data;
    const r = reference.data;
    return (
      a.settlementAsset.toLowerCase() === r.settlementAsset.toLowerCase() &&
      a.unitScalarNum === r.unitScalarNum &&
      a.unitScalarDen === r.unitScalarDen &&
      a.oracle.toLowerCase() === r.oracle.toLowerCase() &&
      a.venue.toLowerCase() === r.venue.toLowerCase() &&
      a.arbiter.toLowerCase() === r.arbiter.toLowerCase() &&
      a.condition.toLowerCase() === r.condition.toLowerCase() &&
      a.routeId === r.routeId &&
      a.maxPriceAge === r.maxPriceAge &&
      a.slippageBps === r.slippageBps
    );
  };
  candidates = candidates.filter(({ entry }) => entry.kind === "profile" || quoteTermsMatch(entry));
  candidates.sort((a, b) => (a.entry.data.pricePerUnitPerHour < b.entry.data.pricePerUnitPerHour ? -1 : 1));

  let stillNeeded = desiredUnits;
  let routerRowCount = 0;
  const rows: AllocationRow[] = [];
  for (const { entry, remaining } of candidates) {
    if (stillNeeded <= 0n) break;
    if (entry.kind === "quote" && routerRowCount >= MAX_ROUTER_BACKERS) continue;
    const take = remaining < stillNeeded ? remaining : stillNeeded;
    rows.push({ entry, remaining, units: take });
    stillNeeded -= take;
    if (entry.kind === "quote") routerRowCount++;
  }

  const totalUnits = rows.reduce((sum, r) => sum + r.units, 0n);
  const premium = rows.reduce((sum, r) => sum + r.units * BigInt(duration) * r.entry.data.pricePerUnitPerHour, 0n);
  const effectiveRate = totalUnits > 0n ? premium / (totalUnits * BigInt(duration)) : 0n;

  return { rows, totalUnits, premium, effectiveRate, shortfall: stillNeeded > 0n ? stillNeeded : 0n };
}

export interface SoloStep {
  kind: "solo";
  profile: SignedLiquidityProfile;
  units: bigint;
}

export interface RouterStep {
  kind: "router";
  rows: { quote: SignedBackerQuote; units: bigint }[];
}

export type QueueStep = SoloStep | RouterStep;

/// Splits an allocation into the transactions it actually requires: one PositionManager.mint
/// per solo profile used, plus (if any router quotes were used) one combined
/// LPRouter.matchAndMint for all of them — reflecting that a solo profile can never combine
/// with anything else in a single call, while router quotes always can (up to 8).
export function splitQueue(rows: AllocationRow[]): QueueStep[] {
  const steps: QueueStep[] = [];
  const routerRows: { quote: SignedBackerQuote; units: bigint }[] = [];
  for (const row of rows) {
    if (row.entry.kind === "profile") {
      steps.push({ kind: "solo", profile: row.entry.data, units: row.units });
    } else {
      routerRows.push({ quote: row.entry.data, units: row.units });
    }
  }
  if (routerRows.length > 0) steps.push({ kind: "router", rows: routerRows });
  return steps;
}
