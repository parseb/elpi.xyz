# DECISIONS.md

**Purpose:** the single register of resolved and open questions for OptionCore, kept
current against whatever revision of the architecture is live (currently v3 —
`MASTER_ARCHITECTURE.md`). Supersedes reading ARCHITECTURE.md §5 as the register directly;
that section is retained there as narrative context, this file is the source of truth for
status. Q-numbers are stable identifiers, not a reading order — do not renumber a question
even if it is resolved, dissolved, or dropped.

This revision: **updates Q2, Q3, Q9 for the v3 (fixed-agreement) schema** — see §9.0's
schema deltas — and **adds Q13**. No other question's resolution changed with v3; Q1, Q4,
Q6 are restated below unchanged for completeness of the register, not because they moved.

---

## Status register

| Q | Topic | Status | Resolution |
|---|---|---|---|
| Q1 | Who is the arbiter signer | **Resolved** | Stateless singleton `ConditionArbiter`, ERC-1271, delegates to `ICondition` |
| Q2 | Fixed vs. configurable settle threshold | **Dissolved (v3)** | No field. Thresholds are `IAuthzModule.policyFor` compile-time constants |
| Q3 | Is the LP side transferable | **Resolved (v3 restatement)** | No — static `economics.lp`. Partial capacity via `reduceCommitment`, not transfer |
| Q4 | Fee base | **Resolved** | 1% of taker-directed outflow; rounds up; remainder to LP |
| Q5 | Is per-position deployment affordable on mainnet | **Re-opened → re-measured** | See GAS.md; gate re-run against the v3 schema |
| Q6 | Oracle/settlement denomination mismatch | **Resolved** | Peg assumption permitted, disclosure mandatory (`pegAssumption()`) |
| Q7 | Multi-LP / partially filled positions | **Resolved — built (Milestone 7, COMPLETE)** | `LPRouter` periphery contract, MASTER_ARCHITECTURE.md §3.9; 17/17 `LPRouter.t.sol` tests passing, including the required `PositionManager._verifySignature` ERC-1271 core fix, a post-implementation High-severity fix (signed `BackerQuote`s, addendum below), and a second post-review High-severity fix (backer crediting bypassable via direct settlement — see LPRouter Finding below, MASTER_ARCHITECTURE.md §3.9 Milestone 8) |
| Q8 | Terms data availability under the salt trick | **Open** | Events + IPFS; archiving redundancy, not on-chain fallback storage |
| Q9 | Cross-chain owner resolution | **Resolved, unchanged by v3** | Mode A default, B opt-in variant, C rejected |
| Q10 | Corporate actions on collateral in a TBA | **Resolved — High-severity finding, mitigation is curation-layer exclusion** | `test/unit/RebasingCollateral.t.sol`; see finding below |
| Q11 | Salt / `positionId` reuse and `createAccount` front-run | **Resolved** | Confirmed by explicit regression test — `test/unit/SaltAndPositionIdReuse.t.sol` |
| Q12 | Should `PositionManager` be non-upgradeable | **Resolved** | Non-upgradeable, confirmed. A bug's blast radius is bounded to future mints only (I2); redeploy + read-only `consumedUnits` migration over a live proxy upgrade |
| Q13 | Mint-time `maxPriceAge` vs. feed cadence | **Resolved (new in v3)** | `IPriceOracle.cadenceHint()`, enforced as a floor at mint — see below |

---

## Q2 — Fixed vs. configurable settle threshold — **dissolved**

v2 framed this as: should `settleThreshold` be a stored, possibly LP-configurable field?

v3 dissolves the question rather than answering it. Once `Pointers` (and therefore the
arbiter slot) are immutable, "2-of-2 vs. 2-of-3" is not a threshold choice at all — it's
**slot occupancy**. `arbiter == address(0)` naturally yields 2-of-2 because only two slots
are populated; a live arbiter yields 2-of-3. There is nothing left to make configurable, and
no field is added:

- `SettleToTaker` / `SettleToLp` / `SweepDust`: threshold **2**, constant.
- `MutualUnwind`: threshold **2**, mask restricted to slots {LP, taker}.
- `RawExecute`: threshold **3**, constant.

A configurable threshold of 3 for settlement would be strictly worse than 2 in every
configuration: if both parties agree, the arbiter adds nothing; if the arbiter is broken,
threshold 3 makes taker settlement permanently unreachable while the LP waits out expiry. No
party benefits from requiring their referee's assent *in addition to* their counterparty's.
**Enforced in:** `IAuthzModule.policyFor` (pure, no per-account state — §2.5).

---

## Q3 — Is the LP side transferable

**No.** `economics.lp` is static for the position's life, and — because `lp` is part of the
`TermsLib` salt preimage — LP transferability can never be retrofitted to an existing
position by *any* mechanism, including a two-step propose/accept. The only escape is
version-per-mint: a new implementation could support a transferable LP slot for *new*
positions, but never for one already minted.

**What answers the practical need instead:** partial capacity management, via
`reduceCommitment` (§3.7), not LP transfer. An LP who published capacity, saw part of it
consumed, and wants to stop taking new fills narrows `totalUnits` down to (at minimum)
`consumedUnits`; already-minted positions are entirely unaffected. This is why Q3 doesn't
need to be re-opened just because Q7 (multi-LP) remains open — they are different problems:
Q3 is about the *identity* of the LP on a live position (closed, permanently), Q7 is about
*more than one* LP backing a position from mint onward (open).

**Enforced in:** `Economics.lp` has no setter anywhere; `IPositionManager.reduceCommitment`
requires `newTotalUnits < currentTotalUnits` and `newTotalUnits >= consumedUnits[profileHash]`.

---

## Q9 — Cross-chain owner resolution — unchanged by v3

Restated for completeness; v3 did not revisit this.

**Mode A (co-located: NFT and account on the same chain) is the default. Mode B
(mainnet-anchored NFT, proved ownership on an L1-settling L2 via Merkle-Patricia proof) is
an opt-in `PositionAccount` implementation variant, selected by `implementation` at mint —
free, since `implementation` is already part of the ERC-6551 derivation tuple. Mode C
(bridge/attestation-based) is rejected on principle:** it makes a bridge a custody
dependency for every position, the largest single source of loss in cross-chain DeFi.

Milestone 0 priced mode B's ownership proof at roughly 250k gas — negligible on an Orbit
chain, so B is gated on *which chains expose a trustworthy L1 block hash*, not on cost. That
remains a Milestone 5 finding, not a schema question. With mainnet back in scope as a
first-class execution chain (§6), mode A alone now also covers the mainnet-native-asset case
directly (NFT and account both on mainnet), which narrows how often B is actually needed.

---

## Q13 — Mint-time `maxPriceAge` vs. feed cadence (new in v3)

**Question:** §2.3 makes mint-time validation the compensating control for lost
repointability — a `maxPriceAge` wrong for its feed is now a position-lifetime defect, not
an inconvenience (OptionHood's bug #2). §3.6 step 7 requires the check exist; it did not
specify a mechanism.

**Recommendation: `cadenceHint() external view returns (uint32)` on `IPriceOracle`,
enforced by `PositionManager` as a floor only:**

```solidity
require(pointers.maxPriceAge >= oracle.cadenceHint(), PriceAgeBelowCadence(...));
```

**Cost:** one extra staticcall to an oracle address already warmed by the `price()` call one
step earlier in the same mint transaction (§3.6 steps 6→7) — a warm `CALL` (~100 gas base)
against an adapter that returns an `immutable` (zero `SLOAD`), plus one comparison and a
conditional custom-error revert. Under **1,000 gas** total; immaterial against the 15%
gate at any of the three chains' representative premiums (GAS.md).

**Why a floor, not a ceiling, and why self-declared rather than registry-published:**

| Rejected option | Why |
|---|---|
| `ModuleRegistry` publishes recommended ceilings; manager reads them at mint | Reintroduces a mint-path read of a registry §3.5 explicitly designed to be advisory ("does not gate minting"), and cannot function for the uncurated tier at all — an uncurated adapter has no registry entry, so gating on it would silently brick every uncurated mint, contradicting `ackUnverifiedTerms` |
| Contract enforces only an absolute ceiling; real validation stays app-side | Leaves the irreversible on-chain commitment with zero protection against the actual documented bug if the app has a bug or is bypassed — unacceptable once nothing can be repaired post-mint |

A ceiling ("is this window too loose for this asset's volatility") needs risk/liquidity
context the contract cannot supply — that stays app-side and curation guidance (§3.5, §8.1).
A floor ("long enough to survive the feed's own declared normal gap") is exactly OptionHood's
bug #2 and is mechanically checkable from one self-declared adapter value.

**Honest limit:** `cadenceHint()` is self-declared, exactly like `price()` itself — a
malicious adapter can lie about both. This closes the *honest-but-buggy* configuration
failure mode (the one that actually happened), not the adversarial-adapter case, which the
curation/acknowledgement model (§3.5) is the only defense against and always will be.

**Interface:** `src/interfaces/IPriceOracle.sol`. **Enforced in:**
`IPositionManager.mint`, error `PriceAgeBelowCadence` (`src/interfaces/IPositionManager.sol`).

---

## Open questions, restated for tracking (unchanged by this revision)

- **Q7 — Multi-LP / partially filled positions.** Resolved and built as `LPRouter`, a
  periphery contract occupying slot 0 via ERC-1271 (MASTER_ARCHITECTURE.md §3.9,
  Milestone 7, COMPLETE) — not variable-length signer sets, which remains rejected (§2.5). Key
  finding during design: this needed one real core change after all
  (`PositionManager._verifySignature` had no ERC-1271 branch, unlike `AuthzModule._verify`)
  and one real I3 gotcha (a router that only ever mints with `TakerProfitCondition` has no
  post-expiry recovery path unless it can itself co-sign `SettleToLp`) — both addressed in
  the design, see §3.9.
  **Addendum (found while building the companion app's multi-LP UI, fixed immediately):**
  the first `matchAndMint` implementation took `BackerAllocation{backer, units,
  pricePerUnitPerHour}` as bare, unsigned calldata — the only real check on a backer's
  entry was their standing ERC-20 allowance to the router, which bounds collateral pulled
  but not the *rate* the caller claims that capital earns. Since backers are meant to grant
  one broad, reusable allowance (not a per-match approval), this let anyone permissionlessly
  and repeatedly capture a backer's yield toward zero using only that backer's own
  already-granted allowance — a real High-severity gap, not a theoretical one. Fixed by
  giving each backer an EIP-712-signed `BackerQuote` (mirrors `LiquidityProfile` field-for-
  field: rate, capacity via `maxUnits`/`consumedUnitsForQuote`, duration bounds, option-type
  support, and full module wiring, all backer-committed) — `matchAndMint` now verifies each
  allocation's quote signature and terms before pulling anything. Hashing lives in
  `BackerQuoteLib` (new), matching `DigestLib`/`TermsLib`'s existing pattern of shared
  hash logic for anything that must be independently reproduced outside the verifying
  contract. 7 new regression tests added (17/17 in `LPRouter.t.sol`), including one that
  reproduces the exact exploit (sign a quote, then tamper with its rate before submitting)
  and confirms it now reverts.
  **Second addendum (found during a post-Milestone-7 security review, not while building
  anything new — see the LPRouter Finding below, and MASTER_ARCHITECTURE.md §3.9 Milestone
  8):** `settleAndCredit`'s balance-delta crediting only ran when it was itself the caller —
  but §3.9's own design makes the router's co-signature optional for `SettleToTaker`
  (`{taker, arbiter}` already suffices), so a position settled by calling `PositionAccount`
  directly still paid the router correctly but left its backers permanently uncredited, with
  no way to recover after the fact. A real fund-freeze, not theoretical — PoC-confirmed
  before the fix. Fixed by `ILPSettlementHook`: the account itself notifies `economics.lp`
  after every settlement payout, on every path, independent of which caller triggered it.
- **Q8 — Terms data availability.** Events + IPFS pinning (`PositionManager.mint` step 13,
  §8 item 7). A position whose terms are entirely lost is unspendable — argues for archive
  redundancy, not on-chain fallback storage (which would undo the gas win §1.6 exists for).
- **Q10 — Corporate actions on collateral in a TBA.** Resolved with a formal finding — see
  below. Verified against a mock rebasing token (`test/unit/RebasingCollateral.t.sol`); a
  real corporate-action re-verification against the specific curated token before mainnet
  remains good practice but the mechanism and mitigation are now understood, not merely
  believed.
- **Q11 — Salt / `positionId` reuse; `createAccount` front-run with a different
  `implementation`.** Resolved: `test/unit/SaltAndPositionIdReuse.t.sol` confirms both
  premises directly against the real contracts, not by argument alone —
  (1) `positionId` (`PositionManager._nextPositionId`, private, only ever incremented, no
  reset path) is observed strictly sequential and never repeated across several real mints;
  (2) the real canonical registry's own `account()` derivation produces a different address
  for a different `implementation` even holding salt/chainId/tokenContract/tokenId fixed,
  confirmed both as a standalone property and end-to-end — an attacker who front-runs a real
  mint's exact predicted salt/positionId via `createAccount` with a different implementation
  deploys an inert, irrelevant contract at an irrelevant address; the real mint afterward
  still derives and uses its own correct address, fully functional, with no trace of the
  front-run attempt on the real position.
- **Q12 — Should `PositionManager` be non-upgradeable?** Resolved: yes, non-upgradeable
  (as already implemented — plain constructor, no proxy). §4.2's own logic: an upgradeable
  manager holds a standing key able to redefine what every future mint means, which cuts
  against I2/I3's no-admin ethos, and a manager bug's blast radius is already bounded to
  future mints only — every already-minted position is fixed and unaffected regardless of
  what the manager later does (I2). Accepted cost: a genuine manager bug needs a fresh
  deployment plus a `consumedUnits`/`profileOwnerOf` migration for outstanding LP capacity —
  deliberately a read-only, one-time migration (the new manager can lazily read the old
  manager's view functions rather than needing a live state copy), not a live proxy upgrade
  that leaves a permanent admin key in place.

---

## P&L formula and settlement branches

**No-strike futures P&L** (preserved from OptionHood, §4.1), generalized by
`unitScalarNum/unitScalarDen` (standardized across assets to `1/100`, where 1 Unit = 0.01 Underlying Asset):

```
CALL:  P&L = (exitPrice − entryPrice) × units × (unitScalarNum / unitScalarDen)
PUT:   P&L = (entryPrice − exitPrice) × units × (unitScalarNum / unitScalarDen)
```

Both prices are the oracle's 1e18-normalized figures (§3.3) — never raw feed decimals.

**Settlement branches** (semantics unchanged from OptionHood; mechanism changed from `if`
branches to two `ICondition`s, §2.2/§4.1):

| | Pre-expiry | Post-expiry |
|---|---|---|
| Who may settle | Taker (via `SettleToTaker`, any 2-of-3) | LP (via `SettleToLp`, any 2-of-3) |
| Gate | `TakerProfitCondition`: P&L > 0 **and** oracle fresh within `maxPriceAge` **and** recomputed payout within `slippageBps` of `params.exitPrice` **and** `payout >= params.minPayoutToTaker` | `ExpiryCondition`: `now >= expiry`. **No oracle read** (I3) |
| CALL payout | Venue swap of collateral → settlement for the profit portion; unswapped remainder transferred to the LP directly (unchanged from OptionHood) | Transfer `Realized.recordedCollateral` to the LP directly — no swap (see note) |
| PUT payout | Pay from `Realized.recordedSettlement`; venue swap of the remainder back to collateral asset for the LP (unchanged from OptionHood) | Transfer `Realized.recordedSettlement` to the LP directly — no swap (see note) |
| Taker if unsettled | Loses premium at expiry | — |
| Either party, any time | `MutualUnwind` (LP + taker only): pro-rata split of held balances per `MutualUnwindParams.takerBps`, fee still applied to the taker-directed portion | same |

**Note — a real change from OptionHood, not a restatement, and scoped to post-expiry
only:** OptionHood's post-expiry PUT path swapped the full held settlement-token balance
back to the stock token for the LP. `SettleToLp` in OptionCore does **no swap at all** — I3
requires it to be computable from `block.timestamp` alone with no external module call, so
it transfers whatever `Realized` holds, in the asset it's already held in. An LP recovering
a PUT position post-expiry gets settlement asset, not collateral asset, back. This is a
deliberate consequence of I3 and should be stated plainly in LP-facing docs (§4.3 risk #2) —
it is a different property than OptionHood had, not a bug. **This does not extend to
pre-expiry `SettleToTaker`**, where OptionHood's swap-the-remainder-back behavior is
preserved unchanged (an earlier draft of this table incorrectly applied the "no swap" note
to both columns — corrected here): pre-expiry settlement is not on an I3 path and has no
oracle-free requirement to satisfy, so there is no reason to give up the remainder-swap
there, and no requirement forcing it either way.

---

## [HIGH] Q10 Finding — Non-transfer collateral balance changes can permanently brick a position

**Severity**: High
**Type**: Token Integration / Accounting
**Location**: `src/PositionAccount.sol` — `settleToTaker` (L216-238, `_settleToTakerCall`
L263-287), `settleToLp` (L321-334), `mutualUnwind` (L341-361)
**Status**: Confirmed

### Description
Every settlement path transfers exactly `Realized.recordedCollateral` /
`Realized.recordedSettlement` — the amount measured once at mint via
`balanceAfter - balanceBefore` — and never re-reads `balanceOf(address(this))`. This is
deliberate and correct for fee-on-transfer safety (Milestone 3): it is exactly what stops a
fee-on-transfer token from letting the account promise more than it actually holds.

The same design has a symmetric failure mode for any collateral asset whose balance can
change for a specific holder with **no transfer at all** — a positive or negative rebase, a
slashing event, or a deflationary corporate action applied directly to the account's
balance. `Realized` cannot observe this: it was fixed at mint and is never revisited.

### Impact
- **Negative rebase / slashing (High):** if the account's real balance ever falls below
  `recordedCollateral`, every settlement path attempts to move more than the account
  actually holds and reverts. Since all three paths (`SettleToTaker`, `SettleToLp`,
  `MutualUnwind`) use the same fixed recorded amount, **no path can ever succeed again** —
  this is a genuine I3 violation for this specific asset class: permanently stranded funds,
  with v3 having neither an admin function nor a repoint mechanism to recover them.
- **Positive rebase (Medium):** if the balance rises above `recordedCollateral`, settlement
  still moves only the recorded amount — correct, but the excess is left in the now-settled
  account permanently. `sweepDust` cannot recover it: it unconditionally refuses any token
  equal to `economics.collateralAsset`/`economics.settlementAsset`, with no exception for an
  already-settled position. The yield is not stolen or misdirected — it is simply
  unreachable by any party, forever.

### Root Cause
`PositionAccount` treats `Realized` as the sole source of truth by design (§3.1, Milestone
3's NatSpec on the `Realized` struct) specifically to be safe against fee-on-transfer
tokens. That same invariant — "balance changes only happen through transfers this contract
initiated or observed" — is exactly what a rebasing, slashable, or otherwise
corporate-action-bearing token violates. There is no general fix that preserves both
properties simultaneously: re-reading `balanceOf` at settlement time to tolerate rebases
reopens the fee-on-transfer hole Milestone 3 closed.

### Proof of Concept
`test/unit/RebasingCollateral.t.sol`, both passing against a `MockRebasingERC20` that
mutates a holder's balance directly (`_mint`/`_burn`, no `Transfer` counterparty):
- `test_positiveRebase_excessPermanentlyStuckAndUnsweepable` — mints a CALL, rebases the
  account's collateral balance up by 3e18 post-mint, executes `MutualUnwind`, and confirms
  exactly the recorded 10e18 moves while the 3e18 excess remains — then confirms
  `sweepDust` reverts with `CannotSweepPositionAsset` when attempted against it.
- `test_negativeRebase_bricksEverySettlementPath` — mints three otherwise-identical CALL
  positions, rebases each account's collateral balance down to zero post-mint, and confirms
  `MutualUnwind`, `SettleToLp` (post-expiry, the I3 path itself), and a profitable
  `SettleToTaker` all revert.

### Recommendation
**Deliberately no on-chain fix — a considered scope boundary, not deferred work.** An
alternative on-chain design was evaluated (settlement reads live `balanceOf` instead of the
fixed `Realized` amount, capping the taker's oracle-computed entitlement to what's actually
available and routing any rebase-driven delta, either direction, to the LP's leg) and would
technically work without reopening the fee-on-transfer/donation problem `Realized` exists to
solve — those are orthogonal (mint-time floor vs. settlement-time available amount).
Rejected anyway: it adds real complexity and a new class of edge case to the one contract in
this system that most needs to stay simple and auditable (`PositionAccount`), in service of
an asset category (rebasing/slashable/corporate-action-bearing tokens) that is not the
protocol's target market. Standard ERC-20s (WETH, majors) and conventional RWA tokens with
ordinary `transfer`-only balance changes are the design center; the fixed-`Realized`
settlement model is correct and final for them.

The mitigation is exclusion at the curation layer (§3.5), not a contract change: rebasing,
slashable, and otherwise corporate-action-bearing tokens (stETH-style non-wrapped rebasing
tokens, deflationary/tax tokens with per-holder burns, anything with an admin-controlled
balance mutator) must be filtered out of, or explicitly flagged high-risk within, whatever
tier of collateral a `PositionManager` deployment is willing to curate as
`collateralAsset`/`settlementAsset`. This is an off-chain/app-layer allowlisting decision,
not a contract change, and should be stated plainly in LP-facing documentation alongside the
existing I3 disclosure (§4.3 risk #2) — an LP or taker who supplies such a token as
collateral outside any curation safeguard, uncurated per §3.5's own acknowledgement
mechanism, is accepting this risk knowingly, not discovering it later.

---

## [HIGH] LPRouter Finding — Backer crediting silently skipped when a position is settled directly — **Fixed**

**Severity**: High
**Type**: Logic / Accounting / DoS (permanent fund freeze)
**Location**: `src/periphery/LPRouter.sol` — `settleAndCredit` (crediting removed),
`onPositionSettled` (new); `src/PositionAccount.sol` — `_notifyLp` (new), called from
`_settleToTakerCall`, `_settleToTakerPut`, `settleToLp`, `mutualUnwind`
**Status**: Fixed

### Description
`LPRouter.settleAndCredit` used to be the only place a router-backed position's backers were
ever credited: it measured the router's own balance delta immediately before and after
making a settlement call into `PositionAccount` itself. But per §3.9's own design,
`PositionAccount.settleToTaker`/`settleToLp` are public and satisfiable by an ordinary
`{taker, arbiter}` 2-of-3 quorum with **zero router co-signature required** — that is a
deliberate feature (§3.9: "no router judgment needed"), not an oversight. The oversight was
downstream of it: nothing made the router's *crediting* happen on that path too. A position
settled by calling the account directly still correctly paid `economics.lp` (the router) its
LP-directed proceeds — the funds were never lost from the router's own balance — but
`settleAndCredit`'s delta measurement never ran, so no backer's `claimable` balance was ever
incremented. Unrecoverable: once `accountState` advances, `settleAndCredit` can no longer run
against that settlement at all.

### Impact
Permanent freeze of the LP-side collateral of any router-backed position settled this way —
for a moderately in-the-money CALL, that's most of the collateral. The taker is paid
identically either way, so they are economically indifferent to which entrypoint they use —
this can happen from an ordinary ERC-6551 tool interacting with the account directly, not
only from a deliberate attack.

### Root Cause
`ILPRouter`'s own pre-fix NatSpec said the quiet part directly: `settleAndCredit`
"works for either signer combination that reaches quorum... this function does not add
authorization, only crediting, **on top of a call anyone could already make directly**." The
authors correctly reasoned that skipping the router adds no authorization gap, but didn't
carry the same reasoning through to crediting — a call "anyone could already make directly"
is a call that also skips crediting, since crediting lived nowhere except inside the router's
own wrapper.

### Proof of Concept
`test/unit/LPRouterStrandingPoC.t.sol::test_regression_directSettleToTaker_stillCreditsBackerRemainder`
(originally written as a PoC proving the bug, now a passing regression test proving the fix):
mints a 10-unit router-backed CALL across three backers (5/3/2-unit contributions), moves the
price in-the-money, settles via `IPositionAccount(account).settleToTaker` **directly** —
bypassing `settleAndCredit` entirely — and confirms the 8e18 LP-side remainder that lands at
the router is credited to the three backers in exact proportion to their contribution
(4.0e18 / 2.4e18 / 1.6e18), summing to exactly what the router received, with each backer
able to withdraw their share afterward.

### Recommendation (implemented)
Decouple crediting from the call path entirely: `PositionAccount` now calls a best-effort,
gas-bounded hook (`ILPSettlementHook.onPositionSettled`, new —
`src/interfaces/ILPSettlementHook.sol`) on `economics.lp` immediately after every transfer to
it, on every settlement path, regardless of which entrypoint triggered settlement. An EOA
`lp` has no code and is skipped without a call; a non-conforming or malicious contract `lp`
can waste at most a fixed gas stipend (300,000) and can never revert or block settlement
itself — any failure in the hook call is caught and ignored. `LPRouter` implements the hook
and verifies its caller is genuinely `positionId`'s own recorded account (`accountOf`,
populated at match time from `matchAndMint`'s own `manager.mint` return value — replaces the
old `matchedPositions` bool) before crediting, so nothing else can forge a credit.
`settleAndCredit` is now a thin pass-through convenience wrapper with no crediting logic of
its own, preventing the double-credit that would otherwise result from both the old
delta-measurement and the new hook running for the same settlement.

---

## [MEDIUM] PositionAccount Finding — Settlement-time swaps had no oracle-derived floor — **Fixed**

**Severity**: Medium (High on an illiquid/manipulable venue)
**Type**: Oracle / MEV
**Location**: `src/PositionAccount.sol` — `_settleToTakerCall`, `_settleToTakerPut`
(both now call the new `_oracleFloor`)
**Status**: Fixed

### Description
§3.4 states plainly that `minAmountOut` "still comes from the oracle, never from `quote`" —
true at mint (`PositionManager._expectedSwapOutput` derives the PUT creation swap's floor
from the oracle), but not, until this fix, at settlement. Both settlement-time swaps — the
CALL taker-swap and the PUT LP-remainder swap-back — took `SettleToTakerParams.minAmountOut`
directly from the caller with no floor under it at all.

### Impact
For the CALL branch this was self-limiting: the swapped amount is the taker's own payout,
separately backstopped by `minPayoutToTaker` (§3.8), so a bad `minAmountOut` there only hurts
the taker who chose it. For the **PUT** branch it was a real gap: the swap-back converts the
**LP's** remainder to collateral, using a floor the **taker** supplied — and on the
permissionless `{taker, arbiter}` path, the LP never consents to this particular settlement
at all. A taker could set `minAmountOut = 0` and sandwich the LP's own swap on a thin or
manipulable venue, extracting value from the LP's capital with no LP signature required.

### Root Cause
The mint-time oracle floor and the settlement-time caller-supplied value were never unified —
`_expectedSwapOutput` was written once for the PUT creation swap and never reused at
settlement, so the two swaps' floors drifted onto different, inconsistent trust models
(oracle-derived vs. caller-supplied) without that divergence being a deliberate decision.

### Recommendation (implemented)
`PositionAccount` now derives the same oracle-based floor (`_oracleFloor`, mirroring
`_expectedSwapOutput`'s formula and slippage tolerance, but against the live price rather
than the frozen `entryPrice`) for **both** settlement swaps, and takes the caller-supplied
`minAmountOut` as tightening-only — `max(callerValue, oracleFloor)` — never a way to waive
the floor. `_requireProfitable` now returns the live price it already reads so this costs no
extra oracle call on the CALL branch (which already needed it); the PUT branch's one
additional read is on a path with no per-call gas gate (only mint is gated, `GAS.md`).

---

## Rounding: fee UP, payout DOWN, remainder to LP — **confirmed unchanged in v3**

ARCHITECTURE.md §3.6 states this; this section is the explicit confirmation the v3 re-gate
was asked to make, plus a worked example so it's checkable rather than asserted.

**Rule:** on every taker-directed outflow of position assets (`SettleToTaker` and
`MutualUnwind` alike — I4 makes no exception), the account computes:

```
fee    = ceil(grossTakerAmount × feeBps / 10_000)     // rounds UP
payout = grossTakerAmount − fee                        // rounds DOWN, i.e. floor
```

`fee` is never `0` for any nonzero `grossTakerAmount` and nonzero `feeBps` (rounding up
guarantees this, closing the "fee rounds to zero" failure mode). The remainder — whatever
`payout` doesn't capture because `fee` rounded up past the exact fractional cut — is not
tracked as separate dust anywhere; it is simply what the LP already holds by construction,
since the taker only ever receives `payout` and the account's other outflow path
(`SettleToLp`/the LP side of `MutualUnwind`) is what the LP is due, so there is no third
place for a remainder to go. Dust is structurally zero for the position's own assets — the
same property `SWEEP_DUST` exists to handle for *non-position* assets only.

**Worked example** (`feeBps = 100` i.e. 1%, `grossTakerAmount = 10_000_000` units of the
settlement asset's smallest denomination):

| Step | Formula | Value |
|---|---|---|
| Exact 1% | `10_000_000 × 100 / 10_000` | `100_000.0` (exact, no rounding needed here) |
| `fee` (rounds up) | `ceil(100_000.0)` | `100_000` |
| `payout` (rounds down) | `10_000_000 − 100_000` | `9_900_000` |

A case that actually exercises the rounding, `grossTakerAmount = 10_000_007`:

| Step | Formula | Value |
|---|---|---|
| Exact 1% | `10_000_007 × 100 / 10_000` | `100_000.07` |
| `fee` (rounds up) | `ceil(100_000.07)` | `100_001` |
| `payout` | `10_000_007 − 100_001` | `9_900_006` |

The extra unit `fee` picked up by rounding up comes out of what would otherwise have been
the taker's payout, not out of thin air and not out of the LP's recorded balance — confirming
**fee rounds UP, payout rounds DOWN, and the LP is never short a unit because of it.**

**This also structurally eliminates OptionHood's fee-accounting bug**: `collectedFees` there
accumulated a dollar-scaled 18-decimal figure keyed by the stock asset while `withdrawFees`
paid that number out as a raw token amount of that asset — a unit mismatch. There is no unit
to mismatch here because the fee is computed as a fraction of an actual outbound transfer,
in the units of that transfer, and forwarded to `FeeVault` in the same transaction.

**Residual, named honestly (unchanged from ARCHITECTURE.md §3.6):** LP and taker can settle
everything to the LP and have the LP pay the taker off-chain, dodging the fee entirely.
Nothing on-chain can prevent this; it requires the two parties to trust each other with a
side payment, which is exactly the trust the arbiter exists to remove. Fee revenue
projections should assume some leakage, not treat 1% as guaranteed.
