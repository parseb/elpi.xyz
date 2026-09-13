# MASTER_ARCHITECTURE.md

**Working name:** OptionCore (generalized from OptionHood v3.0.0)
**Revision:** v3 — fixed-agreement model.
**Status:** Milestones 0′ through 7 complete (Milestone 7 — LP Router, §3.9 — added a
periphery contract beyond this document's original plan). The §9.0 gas gate has been re-run
against this schema and **passed on all three target chains** (Ethereum mainnet, an OP-stack
L2, an Arbitrum Orbit chain) — see `GAS.md` for the measured numbers, the pre-registered
premiums, and two findings the run surfaced. Q13 (mint-time `maxPriceAge` validation) is
resolved — see `DECISIONS.md`. `src/` contains a real, tested implementation of **every core
contract**: `AuthzModule`/`ConditionArbiter` (Milestone 1), all four `ICondition`s
(Milestone 2, `src/conditions/`), `PositionAccount` (Milestone 3 — the contract that
actually holds collateral), `PositionManager` (Milestone 4, `src/PositionManager.sol` — the
mint orchestrator and ERC-721 ledger), `LPRouter` (Milestone 7, `src/periphery/`), plus
`TermsLib` and `DigestLib`. **Milestone 8 — post-review hardening — also complete** (new,
§9.0 note below): a security-review pass over the whole stack found and fixed one High
(LPRouter backer-crediting silently skipped on a caller path outside the router, §3.9) and
one Medium (settlement-time swaps lacked the oracle-derived floor mint-time swaps already
had, §3.4). **147/147 tests passing** (`test/unit/`, `test/fork/`, `test/invariant/`, plus
`test/gas/`'s gate suite). Three CI lints exist, are self-tested, and check every real
contract in `src/` alongside the Milestone 0′ cost models — see `script/lints/`.

**This is the canonical, current design document.** It supersedes:
- `ARCHITECTURE.md` — the v2→v3 working draft this document consolidates. Kept in place
  for revision history (the "what changed from v2" reasoning below is carried forward from
  it); do not treat it as more current than this file.
- `reference/OPTIONHOOD-v3-SPEC.md` — **prior art, a different, deployed protocol** this
  design generalizes away from (pooled custody, chain ID `4663`, one admin-set
  `ISettlementVenue`, a global `priceFeeds` mapping). Ingested for its fork-testing findings
  and fee-accounting fix; not a spec this protocol implements or must satisfy.

**Companion documents, not duplicated here:**
- `DECISIONS.md` — the live register of resolved/open questions (Q1–Q13). Read it, not the
  "Open questions" section below, for current status; §5 here is retained as narrative
  context for *why*, not as the up-to-date index.
- `GAS.md` — the Milestone 0′ gate: pre-registered premiums, measured gas, per-chain dollar
  costs, decision-rule verdicts, and two findings (the §1.6 calldata trade doesn't bite
  under 2026 L1 pricing; OP-stack calldata cost tracks compressibility, not byte count).
  `GAS-v2-ARCHIVED.md` holds the prior (now-superseded) v2-schema run, for context only.
- `src/` — `interfaces/`, `types/`, `libraries/TermsLib.sol`. Declarations and NatSpec
  matching every schema decision below; no business logic.
- `script/lints/` — the three new §7.2 CI lints (`no-term-sstore.sh`, `no-term-sload.sh`,
  `no-repoint-mutator.sh`), each self-tested against both clean code and a deliberate
  violation (`script/lints/self-test.sh`, `test/lints/fixtures/`).

### What changed from v2 of this document

v2's thesis was that a position's dependency pointers should be mutable by its own parties,
on resilience grounds: LP and taker acting together could repair a position whose venue went
illiquid or whose oracle broke, instead of being forced to unwind. That reasoning was sound
but it was purchased with five cold `SSTORE`s at mint, and mint is the scarce resource.

v3 takes the narrower position:

> **A position is a fixed agreement between two consenting parties over disclosed risks.
> The protocol defines the position format, registers and coordinates counterparties,
> provides a referee, guarantees the taker the payout they were quoted, and takes 1% of
> profitable settlement. Every term — including which oracle and which venue — is fixed at
> mint by address derivation and is thereafter unchangeable by anyone, including the
> parties.**

The justification is duration. Positions are bounded by the LP profile's
`minHours`/`maxHours` — hours to days. In-place repair of a broken dependency is a luxury
over that window, and the two rungs that actually prevent stranded funds (oracle-free
post-expiry LP recovery, and LP+taker mutual unwind) never depended on mutability in the
first place. Resilience moves from *repair* to *exit*, which is cheaper and simpler to
reason about.

Six consequences, each traced below:

1. **`REPOINT` is removed** and `Pointers` moves from account storage into the ERC-6551
   salt. Five cold `SSTORE`s leave the mint path; `initialPointersHash` and the digest's
   `pointersHash` field both disappear as redundant.
2. **The settle threshold becomes a compile-time constant.** v2's Q2 dissolves without
   adding a field — see §2.5 and `DECISIONS.md`.
3. **Mainnet issuance returns to scope, and stays in scope.** v2 concluded L2-only on the
   strength of a gate run against the now-abandoned schema and 2021–2023-era gas prices.
   §9.0's re-run — against the v3 schema and live 2026 gas conditions — passes on mainnet by
   a wide margin (`GAS.md`). Tokenized-asset depth is concentrated on L1, so this matters
   commercially.
4. **Commitment reduction is added** to `PositionManager`, so an LP can narrow unfilled
   capacity without invalidating a whole profile (§3.7).
5. **`minPayoutToTaker` is added** to the taker settlement params, making quote fidelity a
   structural guarantee rather than a UI promise (§3.8).
6. **The stablecoin peg assumption is permitted but must be declared** by the oracle
   adapter (§3.4, closing v2's Q6).

Sections 0, 1.3–1.6, 2.1–2.5, 3, 4, 5, 6.3, 8, and 9 are affected. §7's lint set gains
three rows, now implemented (`script/lints/`).

---

## Table of Contents

0. [Thesis and invariants](#0-thesis-and-invariants)
1. [Section (a) — Account standard and execution-permission model](#1-section-a--account-standard-and-execution-permission-model)
2. [Section (b) — Threshold authorization and arbiter plumbing](#2-section-b--threshold-authorization-and-arbiter-plumbing)
3. [Section (c) — Terms and where they live](#3-section-c--terms-and-where-they-live)
4. [Section (d) — Changed vs. preserved relative to OptionHood](#4-section-d--changed-vs-preserved-relative-to-optionhood)
5. [Section (e) — Open questions and assumptions](#5-section-e--open-questions-and-assumptions)
6. [Multi-chain: replicated stack, local settlement](#6-multi-chain-replicated-stack-local-settlement)
7. [Chain/asset generality checklist](#7-chainasset-generality-checklist)
8. [Companion app scope](#8-companion-app-scope)
9. [Foundry-first build plan and the gas gate](#9-foundry-first-build-plan-and-the-gas-gate)

---

## 0. Thesis and invariants

Four invariants. Every decision below should be checkable against them.

**I1 — Custody follows the position, not the contract.** Collateral lives in an account
bound 1:1 to one position for its entire lifecycle. Settling position A can never touch
position B's collateral. Insolvency is bounded to a single position.

**I2 — Every term of a position is immutable, committed by address derivation.** This
replaces v2's economics/dependencies split. Parties, assets and their decimals, option type,
units, contract multiplier, entry price, expiry, fee rate, *and* oracle, venue, route,
arbiter, condition, staleness window and slippage tolerance are all committed in the
ERC-6551 `salt`. None can change without changing the account's address, which is to say
none can change at all. No admin, no governance vote, no arbiter, and — the change from v2 —
**not even LP and taker acting together**.

What the parties retain is not amendment but **exit**: `MUTUAL_UNWIND` lets them dissolve
the agreement and walk away at any time. The distinction matters. Amendment would let a
position drift from what either party signed; exit cannot. Given hours-to-days durations,
exit is the more useful right and the far smaller attack surface.

The cost, stated plainly because it is real: **a position whose oracle or venue breaks
mid-flight cannot be repaired.** It can only be unwound by mutual agreement, or run to
expiry and recovered by the LP through the oracle-free path. §1.4 and §2.3 lay out what
that leaves.

**I3 — At least one settlement path never depends on the oracle, the venue, the arbiter, or
any other chain.** Post-expiry LP recovery must be computable from `block.timestamp` alone.
LP + taker together must always be sufficient. With per-position custody there is no admin
who can sweep a stuck position, so this is the property that prevents permanently stranded
funds and it has to be designed in, not patched.

I3 does more work in v3 than in v2, because it is now the *only* remedy for a broken
dependency rather than the last of three. Its two paths are therefore the most safety-critical
code in the protocol and are specified to touch nothing external: `SETTLE_TO_LP` reads only
`block.timestamp` and transfers held balances; `MUTUAL_UNWIND` reads nothing and calls no
module. **This is no longer only a design intention — `GAS.md`'s `settleToLp` measurement
was run twice, once against a healthy oracle and once against a mock oracle configured to
revert unconditionally, and produced the identical gas figure (67,838) both times.** I3
holds under an adversarial oracle, empirically, in this cost model.

**I4 — The fee is a term of the position, not an admin knob, and is collected by the
account itself.** Since the protocol never custodies anything, revenue cannot be swept
from a pool. Instead `feeBps` is part of the immutable terms, and the account applies
it to every outflow of position assets directed at the taker slot — on every path,
including mutual unwind (§3.6). Oracle-free, branch-free, unraisable after mint. Rounding
rule confirmed unchanged and worked through with numeric examples in `DECISIONS.md`: fee
rounds **up**, payout rounds **down**, remainder implicitly to the LP.

### Component stack

```
        ETHEREUM MAINNET (hub of record, and a first-class execution chain)
        ┌────────────────────────────────────────────────────────────────┐
        │ ProfileRegistry   ModuleRegistry (curation)   AttestationLog   │
        │ published LP profiles · reviewed adapters · reputation          │
        └────────────────────────────────────────────────────────────────┘
                     no cross-chain read.  no bridge.  no messaging.
                     replication is by identical addresses, not by state sync.
        ────────────────────────────────────────────────────────────────────
        ANY EXECUTION CHAIN, MAINNET INCLUDED (same bytecode, same addresses)
┌───────────────────────────────────────────────────────────────────────────┐
│ PositionManager (ERC-721)   ·   FeeVault   ·   ModuleRegistry (local copy) │
│ no custody · no settlement math · no global per-asset mappings             │
│ per-profile consumed-units counter · reduceCommitment                      │
└──────┬──────────────────────────────────────────────────────────────────┘
       │ registry.createAccount(impl, salt=keccak(Economics,Pointers), chainId, nft, id)
┌──────▼──────────────────────────────────────────────────────────────────┐
│ PositionAccount — holds all collateral for exactly one position          │
│ salt commits EVERY term · storage holds only 2 Realized slots             │
│ SETTLE: 2-of-3 · MUTUAL_UNWIND: LP+taker only · RAW: 3-of-3 + 48h        │
└──┬──────────────────┬────────────────────┬────────────────────────────┘
   │ requireQuorum     │ price()            │ swap()
┌──▼────────────┐ ┌────▼──────────┐ ┌───────▼──────────────┐
│ IAuthzModule  │ │ IPriceOracle  │ │ ISettlementVenue     │
│ M-of-N ERC1271│ │ →1e18 adapter │ │ adapter (+ routeId)  │
└──┬────────────┘ └────▲──────────┘ └──────────────────────┘
   │ slot 2             │
┌──▼────────────┐       │
│ Arbiter 1271  │───────┘  ICondition, pluggable per position type
└───────────────┘          re-derives terms from calldata; never SLOADs them
```

---

## 1. Section (a) — Account standard and execution-permission model

### 1.1 Canonical Registry, purpose-built Account

Keep the canonical ERC-6551 Registry (`0x000000006551c19487814612e58FE06813775758`,
address-identical across chains). Reject the canonical account implementation.

Registry, kept because: it is immutable and adminless; `account(implementation, salt,
chainId, tokenContract, tokenId)` is a pure CREATE2 derivation so addresses are knowable
before deployment; the binding tuple is baked into immutable bytecode so an account cannot
be re-pointed at a different NFT; `createAccount` is idempotent and **permissionless**
(§6.4); and the `chainId` field in the tuple is the native mechanism for the
mainnet-anchored/any-chain-settlement model.

The salt is doing more work in v3 than in v2 — it now commits the *entire* agreement — which
makes the registry's pure-derivation property the single most load-bearing external
dependency in the design. **This is also the only address constant permitted anywhere in
core** (`src/libraries/TermsLib.sol`'s `REGISTRY` constant) — a project-wide constraint, not
just a convention for this address specifically.

Canonical account implementations (`AccountV3`, `SimpleERC6551Account`) gate `execute()`
on `ownerOf(tokenId)`, conflating two rights this protocol must keep apart: the right to
the position's *economic outcome* (freely transferable — that is the point of an ERC-721
position) and the right to *move collateral* (never unilateral, because the collateral is
jointly the LP's and the taker's in proportions resolved only at settlement). Under
canonical semantics, buying the NFT on a marketplace hands you the LP's collateral.

### 1.2 Interface conformance

| Interface | Implemented? | Semantics |
|---|---|---|
| `IERC6551Account.token()` | yes, per spec | `(homeChainId, positionManager, positionId)` from immutable appended data |
| `IERC6551Account.state()` | yes, per spec | monotonic; incremented on every state change; doubles as the quorum nonce |
| `IERC6551Account.isValidSigner` | yes, **divergent** | magic value only for the bound `authzModule`; `0` for the NFT owner, the LP, and the arbiter individually |
| `IERC6551Executable.execute` | yes, **gate relocated** | reverts unless `msg.sender == authzModule`; `operation` must be `0` (`CALL`) |
| `IERC721Receiver` / `IERC1155Receiver` | yes | forward-looking; accepts only the position's own asset set |
| `IERC1271` **on the account** | **no** | an account that can sign arbitrary messages is an unbounded approval vector |

`isValidSigner` returning `0` for the NFT owner is the honest answer and will surprise
generic 6551 tooling that assumes owner-can-act. Say so loudly in NatSpec and in the UI:
*this NFT conveys economic rights, not custody.* `DELEGATECALL`, `CREATE`, and `CREATE2`
are rejected on every path including the 3-of-3 raw path.

`src/interfaces/IPositionAccount.sol` declares the position-specific typed-intent surface
only; `IERC6551Account`/`IERC6551Executable` are the canonical standard (available via
`lib/erc6551-reference`) and are not redeclared.

### 1.3 Action ladder — who may do what

The account's primary API is a small vocabulary of **typed intents**, not raw `execute`.
An approval condition that has to police free-form `(to, value, data)` is a
calldata-pattern-matching exercise, and that is how protocols lose money. Typed intents let
conditions reason over decoded, named parameters.

| Action kind | Required approvals | Arbiter eligible? | Condition | Delay |
|---|---|---|---|---|
| `SETTLE_TO_TAKER` | any 2 of 3 | yes | profitability + freshness + `minPayoutToTaker` | — |
| `SETTLE_TO_LP` | any 2 of 3 | yes | expiry only, **oracle-free** | — |
| `MUTUAL_UNWIND` | **LP + taker only** | **no** | none; fee still applies (I4) | — |
| `SWEEP_DUST` (non-position assets) | any 2 of 3 | yes | asset ∉ {collateral, settlement} | — |
| `RAW_EXECUTE` | 3 of 3 | yes | default-deny | 48h |

`REPOINT` is gone. With it goes the drain path v2 spent a paragraph on — an arbiter that
could vote to repoint the oracle its own condition reads, then satisfy that condition
against a fabricated price. There is no rulebook to change, so the attack has no surface.
**CI-enforced now**, not just argued: `script/lints/no-repoint-mutator.sh` greps for exactly
this regression and is self-tested against a deliberate violation
(`test/lints/fixtures/BadFixtures.sol`).

`eligibleSlotMask` survives, but with one job instead of two: keeping the arbiter off
`MUTUAL_UNWIND`. The reasoning is unchanged and still worth stating — the arbiter is a
referee, not a party, and dissolving an agreement is a party's decision. It also keeps the
authz module's policy expression uniform, which matters for reuse against position types
that don't exist yet.

Native mechanism worth noting: `state()` is part of the action digest (§2.4), so any
approval is void once the account's state advances. In v2 this closed a repoint-mid-settlement
race; in v3 it still closes settle-after-settle and settle-after-unwind replay.

**Which quorum composition is representative, in practice:** because the arbiter is
stateless and permissionlessly assemblable by anyone holding the preimage ("zero keeper
liveness requirement," §2.2), an arbiter-inclusive settlement (one party's direct signature
+ the arbiter) is the operationally common path, not the expensive edge case — a direct
two-human signature (e.g. `MUTUAL_UNWIND`, which structurally excludes the arbiter) is
cheaper but requires both parties to coordinate being online together. `GAS.md` measures
`settleToTaker`/`settleToLp` against the arbiter-inclusive composition for this reason, and
notes the direct-human floor is lower (see `mutualUnwind`'s figure, which has no condition
machinery to invoke at all).

### 1.4 Account immutability, and the one sharp edge

Registry-created accounts are ERC-1167 minimal proxies with the implementation address in
bytecode. No admin, no beacon, no `upgradeTo`. A live position's account code can never
change. Nor, now, can any of its terms.

The edge is wider in v3 than v2: **no bug fixes for live positions, and no dependency
repair either.** A buggy condition, arbiter, oracle, or venue is no longer repairable in
place. Mitigations, in order —

1. **Version per mint.** The implementation address and every term are part of the address
   derivation, so "which account code, which oracle, which venue" is chosen freely at mint
   at zero cost. New positions mint against the newest implementation and the healthiest
   pointers; live ones run out their term. Position lifetimes are bounded by the LP profile's
   `minHours`/`maxHours` — hours to days — so the exposure window is short by construction.
   That is the central advantage of short-dated instruments and v3 leans on it harder than
   v2 did.
2. **Pre-mint verification instead of post-mint repair.** Since a bad pointer set can no
   longer be fixed, the app's pre-trade liquidity and staleness checks (§8) move from
   convenience to load-bearing. A `maxPriceAge` that is wrong for a feed's cadence is now a
   position-lifetime defect, not an inconvenience — which is precisely OptionHood's bug #2,
   and the reason §8.2 refuses to publish a profile whose parameters don't match its feed.
   **Resolved (Q13, `DECISIONS.md`):** `IPriceOracle.cadenceHint()` plus a mint-time floor
   check in `PositionManager` (`maxPriceAge >= oracle.cadenceHint()`) is the mechanism.
3. **`MUTUAL_UNWIND` as the terminal backstop** (I3). It must therefore be the most
   conservatively written function in the codebase: no oracle read, no external module
   call, no swap. Pro-rata transfer of held balances per an LP-and-taker-agreed split
   passed as a parameter, minus the I4 fee on taker-directed amounts.
4. **Oracle-free `SETTLE_TO_LP`** for the case where the taker has gone silent and the
   position has expired. Empirically confirmed oracle-independent — see I3 above and
   `GAS.md`.

No third-party escape hatch, and there should not be one. "Emergency admin can sweep any
position account" reintroduces precisely the centralization per-position custody removes.

### 1.5 Two consequences of counterfactual accounts

**Pre-mint funding.** The address is derivable before deployment, so anyone can fund it in
advance. Therefore **settlement math must never read `balanceOf`** — it uses amounts
recorded when they were established. OptionHood already learned this in a narrower form:
`putSettlementBalance` exists because venue slippage means the contract holds slightly less
than the theoretical `entryPrice`-implied notional, so re-deriving from price was wrong.
Generalized: **recorded amounts are truth; balances are untrusted.** Stray deposits are
recoverable only via `SWEEP_DUST`, which must refuse the collateral and settlement assets
or it becomes a settlement bypass.

**Signer-set mutation mid-flight.** The taker slot resolves to `ownerOf(positionId)`
dynamically, so the position stays tradeable — but an approval signed by owner A is still
floating when the NFT transfers to owner B. The `PositionManager`'s ERC-721 `_update` hook
bumps a per-position `signerEpoch` (state that lives on the `PositionManager`/NFT, **not**
on the account — the account's own storage stays exactly `Realized` + the `state()` nonce),
which is part of the digest. Transfer voids in-flight approvals. Without this, a seller who
pre-signed a settlement can front-run the buyer. No analogue in OptionHood; needs its own
test.

### 1.6 Native standard features, and what each one lets us delete

This is the direct answer to "how to leverage the native features of the standard to
simplify the logic." The salt row does considerably more in v3.

| ERC-6551 native feature | What it replaces |
|---|---|
| **`salt` (bytes32) in address derivation** | v1's entire `TermsRegistry` and `termsHash` slot, **and now v2's five pointer slots and its `initialPointersHash`**. Set `salt = keccak256(Economics, Pointers)`. Every term is then *proven by re-deriving the address* — pass them as calldata, recompute, compare to `address(this)`. **Zero storage, zero registry, zero trust.** (§3.2) |
| **`chainId` in the binding tuple** | a per-option chain field, natively. The NFT can live on mainnet while the account lives on chain X, at an address that is a pure function of the mainnet tuple. No bridge for *address* resolution. (§6) |
| **`implementation` in the derivation** | a version registry and a variant flag. Choosing `SameChainAccount` vs `ProofOwnedAccount`, or v2 vs v3 code, is free and self-describing. |
| **`state()`** | bespoke per-position nonce mappings, and the "invalidate approvals after a state change" problem (§1.3). |
| **`token()`** | storing the NFT contract and token id; it is in immutable bytecode, unspoofable. |
| **idempotent, permissionless `createAccount`** | factory privilege. Anyone — LP, taker, a random relayer — can materialize a position's account with no hub interaction and no permission (§6.4). |
| **ERC-1167 immutable proxy** | per-position upgrade admin. Nothing to timelock. |

**The trade this makes, and what the gate found.** Moving `Pointers` out of storage and
into the salt deletes five cold `SSTORE`s at mint (~110k gas, per the original estimate
this document carried while unmeasured) but adds roughly seven words of calldata to *every*
action, since the account can no longer `SLOAD` what it needs and must be handed it. The
concern, as originally framed: good on mainnet where mint is expensive and calldata is
cheap, **possibly neutral on an OP-stack L2** where calldata is posted to L1 and can
dominate the fee. §9.0 measured this rather than assumed it (mandatory: mint and per-action
costs, separately, per chain). **Verdict: the concern does not materialize under 2026 gas
conditions.** The most calldata-heavy action measured (`settleToTaker`, 2,724 bytes) costs
$0.000584 in live-queried L1 data fee on an OP-stack L2 — three hundredths of a cent. See
`GAS.md`'s findings section for the number and for a second, non-obvious result: L1 data
cost tracks calldata *compressibility*, not raw byte count, so a naive per-byte estimate
would have gotten even the *ranking* of actions wrong.

---

## 2. Section (b) — Threshold authorization and arbiter plumbing

### 2.1 The primitive

One generic module, containing no settlement logic. It answers exactly one question: *for
this account, this action, and these approvals, is the quorum satisfied?*

```solidity
struct SlotApproval { uint8 slot; bytes signature; }

interface IAuthzModule {
    /// @dev Reverts unless `approvals` satisfy the policy for `digest` and `ctx.actionKind`.
    ///      MUST be view w.r.t. its own storage: all state lives in the account.
    function requireQuorum(
        address account,
        bytes32 digest,
        ActionContext calldata ctx,
        SlotApproval[] calldata approvals
    ) external view;

    /// @dev Milestone 0' correction (src/interfaces/IAuthzModule.sol): takes the full
    ///      verified `ctx`, not just `account`. Under v2 an account could be asked for its
    ///      own pointers; under v3 nothing is stored anywhere to ask, so slot resolution
    ///      needs `ctx.economics.lp`/`ctx.pointers.arbiter` directly. The signature below
    ///      is what's actually declared in src/, not the elided version this section
    ///      originally carried.
    function signerSlots(ActionContext calldata ctx) external view returns (address[] memory);

    function policyFor(uint8 actionKind)
        external pure returns (uint8 threshold, uint8 eligibleSlotMask);
}
```

Note `policyFor` is now `pure` and takes no `account`. Since thresholds are constants
(§2.5) and masks are per-action-kind, policy is a property of the *protocol*, not of a
position. That is a small simplification with a real payoff: the module has no per-account
state whatsoever, so there is nothing to initialize, migrate, or get wrong per position.

**`SlotApproval`, not `Approval`.** The shorter name collides with the ERC-721 `Approval`
event in any contract inheriting both — a compile error rather than a subtle bug, but it
surfaces in Milestone 3 and is free to avoid now. (Milestone 0 finding.)

The module never holds funds, never calls the venue, never reads the oracle. It is a pure
predicate — auditable in isolation and reusable for position types that don't exist yet.
**CI-enforced now:** `script/lints/no-term-sload.sh` asserts an empty storage layout for
`IAuthzModule`/`ConditionArbiter`/`ICondition` implementations, self-tested against a
deliberate violation.

### 2.2 The arbiter is a real signer slot, verified via ERC-1271

Make it a real slot rather than a third bespoke approval path. One verification rule
covers all three:

```
verify(signer, digest, sig):
    if signer.code.length == 0:  require(ECDSA.recover(digest, sig) == signer)
    else:                        require(IERC1271(signer).isValidSignature(digest, sig)
                                         == 0x1626ba7e)
```

Three things at once: LP and taker may be EOAs *or* Safes/smart wallets with no extra code;
the arbiter needs no privileged path; the threshold arithmetic stays uniform.

**The preimage problem.** ERC-1271 passes only a `bytes32`. The arbiter cannot evaluate
"is this profitable?" from a hash. Put the preimage in the signature payload and have the
arbiter re-derive the digest:

```solidity
// ConditionArbiter — singleton, stateless, permissionless to call
function isValidSignature(bytes32 digest, bytes calldata sig)
    external view returns (bytes4)
{
    (ActionContext memory ctx, bytes memory hint) = abi.decode(sig, (ActionContext, bytes));

    // 1. Bind the claim to the digest. Without this, the arbiter approves a
    //    *description* of an action rather than the action itself.
    if (_digest(ctx) != digest) return 0xffffffff;

    // 2. Bind the TERMS to the account by re-deriving its address. The arbiter is
    //    reached by staticcall and cannot SLOAD pointers off the account, because in
    //    v3 the account has none. It must therefore verify ctx.economics and
    //    ctx.pointers itself rather than trust the caller's copy.
    if (TermsLib.deriveAccount(ctx.implementation, ctx.economics, ctx.pointers, ctx.homeChainId,
                               ctx.positionManager, ctx.positionId) != ctx.account) {
        return 0xffffffff;
    }

    // 3. Delegate the semantic check to the position's own condition.
    if (!ICondition(ctx.pointers.condition).check(ctx, hint)) return 0xffffffff;

    return 0x1626ba7e;
}
```

**Step 2 is new in v3 and is not optional.** Under v2 the arbiter read pointers from account
storage, which was self-authenticating. Under v3 the pointers arrive as calldata, so an
attacker could otherwise hand the arbiter a `ctx` naming a friendly oracle and a friendly
condition while the account actually commits to different ones — getting a valid arbiter
signature over a fabricated rulebook. Re-deriving the address closes it: a `ctx` whose terms
don't hash to the account's own address is rejected before any condition runs. The account
performs the same check independently, so the guarantee holds even if the arbiter is
malicious. **`TermsLib.deriveAccount` is implemented** (`src/libraries/TermsLib.sol`) — a
pure/view helper shared by the account and the arbiter, exactly as specified here; it calls
the real canonical registry's own `account()` getter rather than re-deriving the CREATE2
bytecode-hash formula locally, on the reasoning that re-implementing math the registry
already computes correctly is a second place for the same bug to hide, not extra safety.
This belongs in Milestone 1 as an explicit adversarial test.

Two properties still fall out. The arbiter is **stateless and permissionless** — anyone can
assemble its approval by supplying the preimage, so **there is no keeper liveness
requirement anywhere in the protocol.** And it is **non-forgeable**, because steps 1 and 2
pin the claim to the exact action *and* the exact agreement.

`ICondition` is the pluggability seam. Note it no longer takes a separate `Pointers`
argument, since `ctx` now carries verified terms:

```solidity
interface ICondition {
    function check(ActionContext calldata ctx, bytes calldata hint)
        external view returns (bool);
    function conditionId() external pure returns (bytes32);
}
```

| Condition | Action kind | Oracle? | Rule |
|---|---|---|---|
| `TakerProfitCondition` | `SETTLE_TO_TAKER` | yes | `now < expiry` && P&L per the economics formula `> 0` && price fresh within `maxPriceAge` && the payout figures in `ctx` match recomputation within `slippageBps` && `payout >= minPayoutToTaker` |
| `ExpiryCondition` | `SETTLE_TO_LP` | **no** | `now >= expiry` |
| `DustCondition` | `SWEEP_DUST` | no | `token ∉ {collateral, settlement}` |
| `NeverCondition` | `RAW_EXECUTE` | no | always false — default-deny |

`ExpiryCondition` reading no oracle is load-bearing for I3: the path that matters most for
not stranding collateral depends on nothing but the block timestamp. **Measured, not just
argued:** `GAS.md`'s `settleToLp` cost is bit-for-bit identical whether the configured
oracle is healthy or set to unconditionally revert.

### 2.3 Stale or unavailable oracle

OptionHood's bug #2 is the cautionary tale: a hardcoded `1 hour` staleness window made
every weekend and after-hours read revert, because equity feeds update 24/5 not 24/7. The
general lesson — **staleness tolerance is a property of the feed, therefore of the
position** — still holds, but v3 draws a harder conclusion from it. `maxPriceAge` is now
fixed for the position's life, so a window that is wrong for its feed cannot be corrected.
It must be right at mint.

Ladder, now two rungs instead of three:

1. **Oracle-free paths stay live.** A stale oracle can block *taker* settlement — a
   conservative failure, since the taker's worst case is an unexercised option and a lost
   premium, the same outcome as declining to exercise — but can never block LP recovery.
2. **`MUTUAL_UNWIND`.** Terminal backstop; no oracle, no arbiter, no venue. Available at any
   time, pre- or post-expiry, so a position with a dead oracle and a live counterparty
   relationship is never stuck waiting for expiry.

Explicit non-goal: no admin override for stuck positions. The ladder is built so one isn't
needed. The compensating obligation, since rung 0 (repoint) no longer exists, is
**mint-time validation**: `PositionManager` must reject a `maxPriceAge` that is implausible
for the named oracle, and the app must refuse to publish a profile whose window contradicts
its feed's cadence (§8.1). Pushing correctness earlier is the price of removing mutability.

**Resolved (Q13, `DECISIONS.md`):** `IPriceOracle.cadenceHint()`, enforced by
`PositionManager` as a floor — `maxPriceAge >= oracle.cadenceHint()`. Cost: under 1,000 gas
(one warm staticcall to an address the mint flow already touched one step earlier for
`price()`), immaterial against the 15% gate on any chain measured.

### 2.4 Digest construction

```solidity
digest = _hashTypedDataV4(keccak256(abi.encode(
    ACTION_TYPEHASH,
    block.chainid,        // execution chain; no cross-chain replay
    account,              // no cross-position replay
    accountState,         // == state(); no in-position replay
    signerEpoch,          // NFT transfer voids in-flight approvals (§1.5)
    actionKind,
    keccak256(abi.encode(params)),
    deadline
)));
```

EIP-712 domain: `name: "OptionCore"`, `version: "1"`, `chainId`, `verifyingContract:
account`. Per-account `verifyingContract` makes a signature for position 7 structurally
invalid for position 8 before the `account` field is even read.

**Finding, surfaced while building the cost model (`test/gas/mocks/MockPositionAccount.sol`),
not before:** a minimal-proxy account cannot cache its EIP-712 domain separator as an
implementation-level `immutable` the way a normal `EIP712` base contract does —
`verifyingContract` (the account's own address) differs per clone, but `immutable`s are
baked into the *implementation's* bytecode and shared, unchanged, across every proxy that
delegatecalls into it. Every digest computation therefore pays for the domain-separator
hash fresh, on every action, rather than once at construction. This is priced into every
`GAS.md` settlement figure, not optimized away.

**`pointersHash` is removed** relative to v2. It existed so that no one could approve a
settlement and have the venue swapped underneath them. With pointers in the salt, the
`account` field already commits to them transitively — the guarantee is now structural
rather than a digest field, which is strictly stronger and one word cheaper.

`keccak256(abi.encode(params))` now transitively commits `minPayoutToTaker` on the taker
settlement path (§3.8), which is what makes quote fidelity non-repudiable. **`params` is
carried inside `ActionContext` as `bytes`, decoded once by the account keyed on
`actionKind`** (`src/types/ActionContext.sol`, `src/types/ActionParams.sol`) — an earlier
draft of the account's interface additionally took a typed params struct as a *second*,
separately-encoded argument on every action function, which is pure duplicated calldata for
identical data. Fixed before it reached a gas measurement; see
`src/interfaces/IPositionAccount.sol`'s NatSpec.

Preserved from OptionHood: the LP's off-chain `LiquidityProfile` keeps the
signature-in-struct-excluded-from-hash trick for IPFS self-containment. It works, it is
tested, and it is the reason the mainnet hub needs no cross-chain read (§6.2).

### 2.5 Slot roles and thresholds

| Slot | Occupant | Resolution |
|---|---|---|
| 0 | LP | `economics.lp` — static (`DECISIONS.md` Q3) |
| 1 | Taker | `ownerOf(positionId)`, dynamic — co-located or proof-resolved (§6.3) |
| 2 | Arbiter | `pointers.arbiter`, fixed at mint; may be `address(0)` |

**Thresholds are compile-time constants.** v2 left open whether a configurable
`settleThreshold` should live in the salt or in pointers. Once pointers are immutable the
question dissolves (`DECISIONS.md` Q2), and the answer is that no stored threshold is needed
at all:

- `SETTLE_TO_TAKER`, `SETTLE_TO_LP`, `SWEEP_DUST`: threshold **2**.
- `MUTUAL_UNWIND`: threshold **2**, mask restricted to slots 0 and 1.
- `RAW_EXECUTE`: threshold **3**.

A configurable threshold of 3 for settlement would be strictly worse than 2 in every
configuration. If both parties agree, the arbiter adds nothing; if the arbiter is broken or
its condition is unsatisfiable, threshold 3 makes taker settlement permanently unreachable
while the LP waits out expiry. There is no scenario in which a party benefits from requiring
their referee's assent *in addition to* their counterparty's.

`arbiter == address(0)` gives 2-of-2 naturally, since only two slots are occupied — a
legitimate configuration for counterparties who want no automation. So the "2-of-2 vs
2-of-3" choice v2 framed as a threshold question is really slot occupancy, and needs no
field. **`settleThreshold` is not added to `Economics`.**

Rejected: variable-length signer sets, weighted signers. Each adds real audit surface; none
is needed for the position types on the roadmap. Revisit if multi-LP positions appear
(`DECISIONS.md` Q7).

---

## 3. Section (c) — Terms and where they live

### 3.1 The split

v2 had three categories. v3 has two, and only one of them touches storage.

| | Immutable terms (`Economics` + `Pointers`) | Realized amounts |
|---|---|---|
| Contents | lp, assets + pinned decimals, optionType, units, scalar num/den, entryPrice, expiry, feeBps, oracle, venue, arbiter, condition, routeId, maxPriceAge, slippageBps | `recordedCollateral`, `recordedSettlement` |
| Stored where | **nowhere** — committed in the ERC-6551 `salt` | account storage, 2 slots |
| Changed by | nobody, ever | written once at mint, never again |
| Verified how | re-derive the account address from the passed structs | `SLOAD` |
| Gas at mint | **0 SSTORE** | 2 SSTORE |

Realized amounts cannot be in the salt because they aren't known until after the transfers
that establish them. Two slots is the irreducible floor for per-position custody with
fee-on-transfer safety. **CI-enforced:** `script/lints/no-term-sstore.sh` diffs the
account's own `forge inspect storage-layout` against exactly `{realized, accountState}` —
`accountState` (the `state()` nonce) is the one non-term slot permitted, since it carries no
economic content.

### 3.2 Committing every term in the salt

```solidity
bytes32 salt = keccak256(abi.encode(
    TERMS_TYPEHASH,
    // economics
    lp, collateralAsset, collateralDecimals, settlementAsset, settlementDecimals,
    optionType, units, unitScalarNum, unitScalarDen,
    entryPrice,          // normalized 1e18 at mint
    expiry, feeBps,
    // pointers — immutable in v3, therefore part of the agreement itself
    oracle, venue, arbiter, condition, routeId, maxPriceAge, slippageBps
));

address account = REGISTRY.account(impl, salt, homeChainId, positionManager, positionId);
```

Verification at action time is one `keccak256` and one address comparison against
`address(this)`. If any passed field is wrong by a single bit, the derived address differs
and the call reverts. **Implemented as `TermsLib.termsSalt` /
`TermsLib.deriveAccount`** (`src/libraries/TermsLib.sol`).

`initialPointersHash` is deleted. In v2 it was an audit anchor recording what a position
*started* with, distinct from what it currently pointed at. With no repointing there is no
distinction to record, and the field would be a hash of values sitting beside it in the same
preimage.

`feeBps` inside the salt is deliberate (I4): the protocol's cut is fixed at mint and no
admin can raise it on a live position. Fee changes apply only to new positions, which is the
correct policy anyway.

The cost of this trick, now larger: **no term is on-chain readable from the address alone.**
Both structs must be available off-chain to construct any call. Mitigation: `PositionMinted`
emits `Economics` and `Pointers` in full (`src/interfaces/IPositionManager.sol`), and the app
pins both to IPFS — OptionHood's pipeline already does this for profiles, so it is
incremental. State the soft data-availability dependency plainly rather than discovering it
later (`DECISIONS.md` Q8).

### 3.3 Schemas

```solidity
struct Economics {              // in salt; never stored
    address lp;                 // static for the position's life (DECISIONS.md Q3)
    address collateralAsset;  uint8 collateralDecimals;   // queried, never assumed
    address settlementAsset;  uint8 settlementDecimals;   // queried, never assumed
    uint8   optionType;         // 0 = CALL, 1 = PUT
    uint256 units;
    uint256 unitScalarNum;      // unit scalar numerator (1 for 0.01 asset/unit standard)
    uint256 unitScalarDen;      // unit scalar denominator (100 for 0.01 asset/unit standard; 1 Unit = 0.01 Asset)
    uint256 entryPrice;         // normalized 1e18
    uint64  expiry;
    uint16  feeBps;             // <= 100 (1%), fixed at mint
}

struct Pointers {               // in salt in v3; NOT stored, NOT changeable
    address oracle;              // IPriceOracle adapter, normalizes to 1e18
    address venue;               // ISettlementVenue adapter
    address arbiter;              // slot-2 signer; address(0) => 2-of-2
    address condition;            // ICondition for this position type
    bytes32 routeId;              // opaque to core; adapter-interpreted
    uint32  maxPriceAge;           // must match the feed's cadence AT MINT (§2.3)
    uint16  slippageBps;           // <= 500 (5%)
}

struct Realized {               // written once at mint; the only account storage
    uint256 recordedCollateral; // measured as balanceAfter - balanceBefore
    uint256 recordedSettlement; // exact PUT creation-swap output, if any
}
```

Both structs above are declared verbatim in `src/types/Economics.sol` and
`src/types/Pointers.sol`, with full NatSpec.

Struct packing note, carried from Milestone 0: as declared, `Pointers` occupied **five**
256-bit slots, not §v2-3.3's optimistic "~2 packed" — four addresses cannot pair up, and
`routeId` needs a full word. That measurement is what made the v2 mint cost what it was, and
it is precisely the cost v3 deletes by moving the struct into the salt. The finding is
retained here because it explains the size of the improvement §9.0's re-run measures
(`GAS.md`).

Field notes:

- **`unitScalarNum`/`unitScalarDen`** generalize contract unit multipliers (standardized to `1/100` across all assets: 1 Unit = 0.01 Underlying Asset) without a fixed-point library.
- **`entryPrice` normalized to 1e18**, not the oracle's native decimals. OptionHood stores
  Chainlink's 8dp value and threads `1e20` constants through `_minAmountOut`; normalizing
  once at the adapter boundary deletes that whole class of arithmetic bug. **This class of
  bug is not merely theoretical for this project either** — writing the gas-gate cost model
  surfaced exactly this mistake in a test condition (mixing a 1e18-scaled price delta with
  raw settlement-asset units); see `GAS.md`'s bug log.
- **`routeId` opaque `bytes32`.** OptionHood's adapter carries a default fee tier plus
  `setFeeTierOverride` — venue-specific config leaking into a venue-agnostic design. An
  opaque adapter-interpreted identifier means a v4-hook adapter or a multi-hop adapter needs
  no core change, which is also where the single-hop limitation gets fixed.
- **Decimals queried and pinned.** `staticcall decimals()` at mint, revert on failure.
  Tokens without `decimals()` cannot be onboarded (accepted).
- **No `settleThreshold`.** See §2.5.

### 3.4 Adapter interfaces

```solidity
interface IPriceOracle {
    /// @return price collateral denominated in settlementAsset, ALWAYS scaled to 1e18
    /// @return updatedAt timestamp of the underlying observation
    function price(address collateralAsset, address settlementAsset)
        external view returns (uint256 price, uint256 updatedAt);

    /// @notice MUST encode whether this adapter quotes the pair directly or relies on a
    ///         peg assumption (e.g. a USD feed read against a stablecoin settlement
    ///         asset), and MUST change if that changes. See the peg disclosure rule below.
    function oracleId() external view returns (bytes32);

    /// @return true if this adapter substitutes a fiat reference for the settlement asset
    /// @return pegged the asset assumed to hold its peg, or address(0) if none
    function pegAssumption() external view returns (bool assumesPeg, address pegged);

    /// @notice Resolved Q13 (DECISIONS.md): this feed's expected update cadence under
    ///         normal operation. PositionManager enforces maxPriceAge >= cadenceHint() as
    ///         a FLOOR (not a ceiling) at mint.
    function cadenceHint() external view returns (uint32);
}

interface ISettlementVenue {
    function swap(address tokenIn, address tokenOut, uint256 amountIn,
                  uint256 minAmountOut, uint256 deadline, bytes32 routeId)
        external returns (uint256 amountOut);

    /// @notice Advisory only. NEVER used to derive minAmountOut.
    function quote(address tokenIn, address tokenOut, uint256 amountIn, bytes32 routeId)
        external view returns (uint256);
}
```

Both declared verbatim in `src/interfaces/IPriceOracle.sol` and
`src/interfaces/ISettlementVenue.sol`.

`minAmountOut` still comes from the oracle, never from `quote` — preserving OptionHood's
best security property: a pool-price manipulator cannot force a worse-than-oracle fill.
`quote` exists so the app can warn "this route is illiquid" before anyone pays gas, which
OptionHood's own liquidity findings show is a real need — two of three onboarded tickers
were untradeable and nothing surfaced it.

**[MEDIUM] Milestone 8 finding: this held at mint but not at settlement, until fixed.**
`PositionManager` has always derived the PUT creation swap's `minAmountOut` from the oracle
(`_expectedSwapOutput`). `PositionAccount`'s two settlement-time swaps — the CALL taker-swap
and the PUT LP-remainder swap-back — did not: both took `SettleToTakerParams.minAmountOut`
straight from the caller with no floor under it at all. For the CALL branch this is
self-limiting (it only bounds the taker's own payout, separately backstopped by
`minPayoutToTaker`, §3.8). For the **PUT** branch it was a real gap: the LP's remainder is
swapped back to collateral using a floor the *taker* supplied, and on the permissionless
`{taker, arbiter}` path the LP never consents to that specific settlement at all — a taker
could set `minAmountOut = 0` and sandwich the LP's own swap on a thin venue. Fixed by having
`PositionAccount` derive the same oracle-based floor mint-time swaps already use for both
settlement swaps, treating any caller-supplied `minAmountOut` as tightening-only (never a way
to waive the floor). See `src/PositionAccount.sol`'s `_oracleFloor`.

**Peg disclosure (closes v2's Q6, `DECISIONS.md`).** A stablecoin peg assumption is
permitted. OptionHood read an NVDA/**USD** feed while settling in **USDG** and treated them
as interchangeable; v3 allows exactly that, but requires the adapter to *say so* via
`pegAssumption()` and to encode it in `oracleId()`. `ModuleRegistry`'s review template must
record it, and the app must surface it in the risk assessment shown before signing (§8.1).

The residual is honest and consistent with the v3 thesis: a depeg moves settlement math in
one party's favor and nothing on-chain notices. Under fixed agreements over disclosed risks
that is a risk the parties consent to, bounded by short duration. What is not acceptable is
the OptionHood situation, where the assumption existed but had no owner and appeared nowhere.

The oracle adapter taking *both* assets, rather than returning a USD price, is retained: it
permits direct pair quoting for adapters that can manage it, at no interface cost.

### 3.5 Who chooses the terms — curation, not gating

**`ModuleRegistry` is advisory.** It records reviewed adapters and conditions with the
evidence behind the review. It does not gate minting. Two tiers:

| Tier | How it's used | Governance |
|---|---|---|
| `CURATED` | app shows a verified badge; default selections; recommended `maxPriceAge`/`slippageBps` ceilings shown as guidance | addition: 5-day timelock; removal and *tightening* of guidance: instant |
| uncurated | fully usable, but the mint path requires an explicit `ackUnverifiedTerms` flag set **both** in the LP's signed profile **and** in the taker's mint call | none |

The 5-day timelock — OptionHood's `ADMIN_ACTION_DELAY` pattern — applies only to
*expanding what carries the protocol's endorsement*, which is trust-expanding and therefore
worth delaying, while removal is instant because it only narrows. Critically, curation
changes have **zero effect on live positions**: they are not read at settlement, only at
mint and in the UI. Nothing can be stranded by a delisting. **This is also why Q13's
mint-time cadence check is self-declared by the adapter (`cadenceHint()`) rather than
registry-published**: a registry-gated check cannot work for the uncurated tier by
definition, and would silently brick every uncurated mint against an unlisted adapter — see
`DECISIONS.md` Q13 for the full reasoning this shaped.

Consent is two-sided and, in v3, final. Pointers appear in the LP's EIP-712-signed profile,
so the taker cannot substitute a fake oracle; and the taker's mint call must acknowledge the
exact pointer set, so the LP cannot lure a taker into a venue that skims. Neither party
chooses unilaterally — and unlike v2, neither party can revisit the choice afterward. This
raises the stakes on pre-mint disclosure considerably, which is why §8's risk assessment is
no longer a nice-to-have.

Note the honest limit: **two consenting parties can point a position at anything, including
something terrible, and are then stuck with it for the position's duration.** That is the
correct outcome for a protocol that doesn't enforce venues. The protocol's obligations are to
make the choice legible *before* it is made, to default well, and to make sure a bad choice
can never harm a third party or another position (I1).

Preserved from OptionHood: `renounceRole` stays instant (only ever reduces the caller's own
privilege); `grantRole`/`revokeRole` remain disabled in favor of timelocked
propose/execute, closing the loophole where an admin instantly grants themselves a fresh
role instead of upgrading.

### 3.6 Mint flow

```
taker calls PositionManager.mint(profile, units, durationHours, pointers, acks)
  1. verify LP's EIP-712 signature over profile (signature field zeroed in hash);
     require profile.chainIds includes block.chainid          [replay containment, §6.2]
  2. check profile not invalidated; record ownership-on-first-use          [preserved]
  3. require consumedUnits[profileHash] + units <= profile.totalUnits;
     consumedUnits[profileHash] += units                              [NEW, §3.7]
  4. require pointers match the profile's committed set; require acks if uncurated
  5. staticcall decimals() on both assets; require success; pin values
  6. read oracle.price(collateral, settlement); require fresh; normalize -> entryPrice
  7. bounds: maxPriceAge >= oracle.cadenceHint() [Q13], slippageBps <= 500,
     feeBps <= 100
  8. salt = keccak256(TERMS_TYPEHASH, Economics{...}, Pointers{...})
     account = REGISTRY.createAccount(impl, salt, homeChainId, address(this), positionId)
  9. _safeMint(taker, positionId)                       // taker becomes slot-1 signer
 10. transferFrom(lp -> account, collateralAmount); record balanceAfter - balanceBefore
 11. transferFrom(taker -> lp, premium)                 // premium NEVER enters the account
 12. if PUT: account.initialSwap(...) via venue, oracle-derived minAmountOut; record output
 13. emit PositionMinted(positionId, account, economics, pointers)   // full structs
```

**No `initialize(pointers)` step.** v2 needed one, gated on `msg.sender == positionManager`
and first-use-only, because `createAccount` is permissionless and a third party could
pre-deploy the proxy. In v3 there is nothing to initialize — the account's terms are its
address. Pre-deployment by a stranger is now completely harmless rather than
harmless-if-guarded, which removes a guard, a failure mode, and a test.

**Premium never enters the account** (step 11). This is a small decision with a large
payoff: the account's *only* outflow of position assets to the taker slot is settlement
profit, so I4's fee base is unambiguous without any accounting.

**Fee mechanism (I4).** The account withholds `feeBps` from every position-asset outflow
directed at the taker slot, on every path — `SETTLE_TO_TAKER` and `MUTUAL_UNWIND` alike —
and forwards it to the local `FeeVault` (an address-identical deterministic deployment, §6.5).
Rounding is **up** on the fee, so it can never round to zero and break the I4 invariant;
payout rounds down and the remainder goes to the LP, so dust is structurally zero.
No oracle, no branch, no admin sweep, and no way for the parties to route around it by
choosing mutual unwind instead of settlement. **Confirmed with worked numeric examples in
`DECISIONS.md`.**

This also structurally eliminates the fee bug OptionHood had to patch: `collectedFees`
accumulated a dollar-scaled 18-decimal figure keyed by the stock asset while
`withdrawFees` transferred that number as a raw token amount of that asset. There is no
unit to mismatch when the fee is a fraction of an actual outbound transfer, measured in the
units of that transfer.

**Residual evasion, named honestly:** LP and taker can settle everything to the LP and have
the LP pay the taker off-chain. That dodges the fee, and nothing on-chain can prevent it.
It requires the two parties to trust each other with a side payment, which is exactly the
trust the arbiter exists to remove — so the evasion is self-limiting, but it is real, and
fee projections should assume some leakage rather than treat 1% as guaranteed.

### 3.7 Commitment reduction (new)

An LP's collateral is **never escrowed before mint.** The LP signs a profile and grants an
ERC-20 approval; `transferFrom` pulls collateral at mint (step 10). So unengaged collateral
already sits in the LP's own wallet, and "withdrawing unused collateral" requires no protocol
feature — reducing or revoking the approval is sufficient and always available.

What does require a feature is **narrowing published capacity** so takers cannot mint against
capacity the LP no longer wishes to offer:

```solidity
mapping(bytes32 => uint256) public consumedUnits;   // profileHash -> units minted

/// @notice Narrow a live profile's offered capacity. Instant, and narrowing only.
/// @dev Callable by the recorded profile owner or its delegate. Instant is correct for the
///      same reason renounceRole is instant: it only ever reduces the caller's own exposure.
function reduceCommitment(bytes32 profileHash, uint256 newTotalUnits) external;
```

Both declared verbatim in `src/interfaces/IPositionManager.sol`.

Requirements: `newTotalUnits < currentTotalUnits` (narrowing only, so it can never be used
to enlarge an offer the LP didn't sign) and `newTotalUnits >= consumedUnits[profileHash]`
(already-minted positions are untouched — they are fixed agreements, and this is the
mechanism's boundary). Full withdrawal of an unfilled offer remains `invalidateProfile`.

Partial engagement therefore behaves as expected: an LP who offered 100 units, saw 30 minted,
and now wants out reduces to 30 and waits out those 30 positions. The 30 live positions are
unaffected in every respect — consistent with I2, since an LP that could alter a live
agreement would be altering collateral it has already committed.

`consumedUnits` is needed regardless to enforce `profile.totalUnits`, so the marginal cost of
`reduceCommitment` is one narrowing setter.

### 3.8 Quote fidelity at settlement (new)

The taker must get what they were shown. `SettleToTakerParams` therefore carries:

```solidity
uint256 minPayoutToTaker;   // asserted AFTER the venue swap AND AFTER fee withholding
```

Declared verbatim in `src/types/ActionParams.sol`.

Enforced as a post-condition on the settlement path: if the venue underfills, or the fee
arithmetic lands lower than quoted, the transaction **reverts** rather than delivering a
silent shortfall. The taker retries against a fresh quote. Because `params` is hashed into
the digest (§2.4), the taker signs the exact figure — the guarantee is structural and
non-repudiable, not a UI convention. `TakerProfitCondition` checks the same bound, so an
arbiter-assembled settlement cannot bypass it.

Two things this pins down that were previously loose. `minAmountOut` protects against the
*venue*; `minPayoutToTaker` protects against everything downstream of it including the fee —
they are not the same bound and both are needed. And **the quote shown to the taker must be
net of the 1% fee**, since the fee is withheld from taker-directed outflow; quoting gross
would make every settlement read as a 1% shortfall against what was displayed. That is an app
requirement (§8.3) with a contract-side backstop.

---

### 3.9 Multi-LP aggregation — the LP Router (new, Q7's resolution)

Q7 (DECISIONS.md) asked whether one position could be backed by more than one LP —
partial-fill liquidity, matched at the taker's requested size across several LPs' published
profiles, each at their own quoted `pricePerUnitPerHour`, up to a bounded maximum. Resolved:
**yes, entirely as a periphery contract** (`src/periphery/LPRouter.sol`), occupying the `lp`
slot the same way `ConditionArbiter` already occupies the arbiter slot — via ERC-1271, not
via any change to the 3-slot signer model itself (a variable-length signer set was already
rejected, §2.5; this does not reopen that).

**Why this needed one core change, not zero.** `AuthzModule._verify` already branches
ECDSA-or-ERC-1271 depending on whether a signer has code (§2.2) — but
`PositionManager._verifySignature` did not: it called `ECDSA.tryRecover` unconditionally,
with no path for a contract to ever satisfy `signer == profile.lp`. A `LiquidityProfile`
signed by a router contract was therefore unverifiable before this revision. Fixed by giving
`PositionManager._verifySignature` the same ECDSA-or-ERC-1271 branch `AuthzModule` already
has — the identical, precedented pattern, not a new one.

**Why this also needed a second real fix, found post-implementation (High severity, closed
before the companion app's multi-LP UI was built on top of it — DECISIONS.md Q7
addendum).** The first `matchAndMint` took each backer's `{backer, units,
pricePerUnitPerHour}` as bare, unsigned calldata. Since a backer's collateral pull is bounded
by their own standing ERC-20 allowance to the router (never trusted beyond that), it looked
safe — but nothing bounded the *rate* a caller could claim on a backer's behalf. Given
backers are meant to grant one broad, reusable allowance rather than a per-match approval
(step 2 below), this let anyone permissionlessly and repeatedly call `matchAndMint` naming
any backer with an outstanding allowance at a self-serving rate (as low as zero), capturing
that backer's yield using only their own already-granted allowance, with no way for the
backer to stop it short of revoking the allowance entirely — a real fund-safety gap, not a
theoretical one. Fixed by requiring each backer to sign their own `BackerQuote`
(`ILPRouter.BackerQuote`): the router-backed analogue of `LiquidityProfile`, mirroring
nearly every field it commits to (rate, capacity via `maxUnits` + `consumedUnitsForQuote` —
the router's own analogue of `IPositionManager.consumedUnits` — duration bounds, option-type
support, and the full module-wiring tuple), for the identical reason §3.5 already
established for solo LPs: a taker/caller must never be able to substitute terms a
counterparty never agreed to. `matchAndMint` now verifies each allocation's quote signature
and that its committed terms match the call's shared parameters *before* pulling any
collateral — a caller can only choose which already-signed quotes to draw from and how many
units of each (bounded by remaining capacity), never the rate or terms. Quote hashing lives
in `src/libraries/BackerQuoteLib.sol`, mirroring `DigestLib`/`TermsLib`'s existing pattern:
a hash reproduced outside the verifying contract (by whichever backer signs it) belongs in a
shared library, not a private contract method — unlike `LPRouter._hashProfile`, which only
the router itself ever needs, since it self-signs that one.

**The mechanism, in one atomic transaction (`LPRouter.matchAndMint`):**

1. Off-chain (app-layer) matching selects up to **8** backers from currently-published,
   still-available, signed `BackerQuote`s, cheapest `pricePerUnitPerHour` first, until the
   taker's requested size is filled. This is a sort-and-greedy-fill over a short list — the
   same problem any DEX aggregator solves, not a new on-chain algorithm. 8 is a gas-driven
   cap (a bounded loop, not the variable-length signer set §2.5 rejects for the *core*
   3-slot model — this cap lives entirely in the router's own code) and is cheap in
   absolute terms at current gas prices (`GAS.md`'s own baseline: an ERC-20 transfer is
   roughly $0.01; 8 of them is noise).
2. `LPRouter` verifies each allocation's `BackerQuote` signature and terms, then pulls each
   backer's allocated collateral share into itself (`transferFrom`, using a standing
   approval to the router — the same UX shape as approving any router once, not a per-match
   approval).
3. `LPRouter` assembles **one** synthetic `LiquidityProfile` (`lp = address(router)`) sized
   to the combined total, records `approvedProfileHash[thatHash] = true`, and calls
   `PositionManager.mint(...)` — indistinguishable, from `PositionManager`'s point of view,
   from any solo LP's mint.
4. `PositionManager.mint` pulls the aggregate collateral from the router (which now holds
   it) and pays the taker's premium straight to the router in the same transaction.
5. `LPRouter` distributes that premium to each backer **exactly as their own quoted rate
   entitled them to** — computed precisely from real per-backer numbers, never blended or
   averaged. `pricePerUnitPerHour` is spent once at mint and never re-enters `Economics`, so
   nothing about a backer's own price is lost or approximated by aggregating.
6. `LPRouter` records, per `positionId`, each backer's contributed collateral fraction —
   this, not their quoted rate, is what later settlement proceeds split by. Price and
   capital-at-risk are correctly kept as two separate axes.

**Settlement — why the router only needs to actively co-sign one action** (but must still be
*notified* of every settlement, §3.9 Milestone 8 finding below). A router-backed position is
minted with a real `arbiter`/`condition` exactly like any curated position (typically
`TakerProfitCondition`), so pre-expiry profitable settlement already works via the standard
taker+arbiter 2-of-3 path with **zero router co-signature required** — the account's own
`_requireProfitable` and `TakerProfitCondition` already gate it correctly; the router has no
independent judgment to add there. Post-expiry recovery is the one gap: `TakerProfitCondition`
unconditionally rejects at/past expiry (correctly — it is a different action's gate), so a
router-backed position minted with it has no arbiter-assisted `SettleToLp` path at all. Left
unaddressed, this reproduces the exact condition-pairing trap Milestone 6's own invariant
campaign found and fixed in its test harness (§9, Milestone 6) — except here it would be a
real, live I3 violation, not a test bug. Closed by having `LPRouter.isValidSignature`
unconditionally approve `SettleToLp` for any of its own known positions (re-deriving the
account address from the claimed terms first, exactly like `ConditionArbiter` does) — a
direct router+taker 2-of-2, requiring no discretion, since `SettleToLp` is oracle-free and
100% LP-directed by construction. This restores I3 for router-backed positions regardless of
which single `condition` was chosen at mint.

**[HIGH] Milestone 8 finding: "zero router co-signature required" was read, incorrectly, as
"zero router involvement needed at all."** `LPRouter.settleAndCredit` was the *only* place
backers were ever credited — it measured the router's own balance delta around a call it
made itself into the account. But `PositionAccount.settleToTaker`/`settleToLp` are public,
and — as the paragraph above establishes — a `{taker, arbiter}` 2-of-3 already satisfies
`SettleToTaker` with no router co-signature at all. A position settled that way still paid
`economics.lp` (the router) its LP-directed proceeds correctly, but `settleAndCredit`'s
balance-delta measurement never ran, so no backer's `claimable` balance was ever set —
permanently stranded funds, discoverable by anyone using the account directly (accidentally
or not), with the taker fully indifferent between the two paths. Confirmed with a PoC
(`test/unit/LPRouterStrandingPoC.t.sol`) before the fix, now a regression test after it.
**Fixed by decoupling crediting from the caller entirely:** `PositionAccount` now calls a
best-effort, gas-bounded hook (`ILPSettlementHook.onPositionSettled`,
`src/interfaces/ILPSettlementHook.sol`) on `economics.lp` immediately after every transfer to
it, on every settlement path (`settleToTaker`, `settleToLp`, `mutualUnwind`) — an EOA `lp` has
no code and is skipped without a call; a non-conforming or malicious contract `lp` can waste
at most a fixed gas stipend and can never block settlement itself. `LPRouter` implements the
hook, verifying the caller is genuinely `positionId`'s own account (`accountOf`, recorded at
match time — replaces the old `matchedPositions` bool with the exact address) before
crediting. `settleAndCredit` is now a thin pass-through with no crediting logic of its own —
crediting happens the same way regardless of which entrypoint triggered settlement.

**Deliberately unsupported in v1:** `MutualUnwind` (LP-side discretionary consent — the
router has no rule-based way to grant this on behalf of N backers with potentially
conflicting preferences without added governance machinery), `SweepDust`, and `RawExecute`
for router-backed positions. Both settlement paths that matter economically
(`SettleToTaker`, `SettleToLp`) are fully available; these three are quality-of-life paths a
solo LP has that a pooled position does not, stated plainly rather than silently degraded.

**What does not change:** `AuthzModule`, `ConditionArbiter`, every `ICondition`, and the
3-slot model itself — none of these gained any router-specific branch. `PositionAccount` is
the one exception, and it is a narrow one (Milestone 8 finding above): a generic,
router-agnostic notification hook, not LP Router-specific logic living in the account.
`LPRouter` is still a new, optional periphery contract; a solo LP publishing their own
`LiquidityProfile` directly (an EOA `lp`, or any contract `lp` that doesn't implement
`ILPSettlementHook`) is entirely unaffected by any of this — the hook is skipped for them.

**App-facing surface, added for §8:** `LPRouter.backerAllocationsOf(positionId)` returns the
exact per-backer collateral breakdown for a router-backed position (parallel arrays, not a
struct array — simpler ABI decoding); `BackerContributed` is emitted once per backer at
match time so an app can index "which positions does backer X back" by topic filter alone.
`claimable(backer, asset)` reads a backer's current withdrawable balance. These three, plus
`matchAndMint`/`settleAndCredit`/`withdraw` themselves, are the whole surface the companion
app's multi-LP matching flow and account inspector need (§8); `onPositionSettled` is not
app-facing — the account is its only caller.

---

## 4. Section (d) — Changed vs. preserved relative to OptionHood

### 4.1 Preserved

| Preserved | Why |
|---|---|
| No-strike futures P&L, `(exit − entry) × units × scalar` | the product thesis; only the scalar generalizes |
| Off-chain EIP-712 `LiquidityProfile`, signature embedded but excluded from the hash | IPFS self-containment; and it is what makes the hub non-load-bearing (§6.2) |
| Profile lifecycle: ownership-on-first-use, `nonce`, `invalidateProfile`, delegation | replay and lifecycle handling is already right |
| ERC-721 position with paginated on-chain taker/LP indexes | no external indexer dependency |
| Settlement asymmetry: pre-expiry taker-only-if-profitable, post-expiry LP-unconditional; **pre-expiry PUT still swaps the LP's remainder back to collateral asset** | now two `ICondition`s instead of `if` branches; semantics unchanged pre-expiry — see `DECISIONS.md`'s P&L table for exactly what changed (post-expiry only) and what didn't |
| Oracle-derived `minAmountOut`, never venue spot | OptionHood's strongest security property |
| Fee cap 100 bps, slippage cap 500 bps | now per-position ceilings rather than globals |
| 5-day timelock on trust-expanding actions; `grantRole`/`revokeRole` disabled in favor of propose/execute | already hardened; retargeted at curation |
| Venue-agnostic adapter interface | the seam that made this generalization tractable at all |
| `deal()` is unusable against proxied tokens — impersonate a holder and `transfer()` | hard-won; belongs in the test-harness README |
| `evm_version = "cancun"` or later | OptionHood's fourth finding; keep the comment explaining why — see `foundry.toml` |

### 4.2 Changed

| Dimension | OptionHood v3 | OptionCore v3 |
|---|---|---|
| Custody | pooled in core; mappings + `transferFrom` | one ERC-6551-bound account per position |
| Blast radius of a custody bug | all positions | one position |
| Oracle / venue selection | global mapping + one admin-set venue per deployment | per-position, chosen by both parties at mint, fixed for the position's life, admin-proof |
| Protocol's role | enforces the venue and the feed | defines the format, registers, coordinates, referees, guarantees the quote, takes 1% |
| Onboarding an asset | admin `setPriceFeed` on a live contract | an LP writes a profile referencing an adapter. No admin action. |
| Onboarding a chain | edit `NetworkConfig.sol`, redeploy | deploy the address-identical stack + adapters; **core bytecode unchanged** (§6) |
| Terms storage | struct fields in core mappings | **0 slots** (all terms in salt) + 2 (realized) |
| Settlement authorization | role checks + `if` branches | `IAuthzModule` constant threshold + mask + pluggable `ICondition` |
| Arbiter / automation | none | third slot, ERC-1271, condition-gated, no liveness requirement |
| Mutual early unwind | unsupported | free consequence of the threshold model; the terminal backstop |
| Amendment after mint | admin could repoint the venue under every live position | **nobody can amend anything** |
| LP capacity management | `invalidateProfile` only (all-or-nothing) | `reduceCommitment` for partial narrowing (§3.7) |
| Taker payout guarantee | `minAmountOut` on the swap only | `minAmountOut` **and** `minPayoutToTaker` net of fee (§3.8) |
| Contract multiplier | hardcoded `0.1 Share` | `unitScalarNum/Den` (`1/100` standard: 1 Unit = 0.01 Asset) |
| Decimals | 18 / 6 / 8 hardcoded; `1e20` constants | queried, pinned, normalized to 1e18 at the adapter boundary |
| Chain identity | chain ID 4663, USDG, SwapRouter02 quirks in logic | configuration; router quirks confined to one adapter |
| Staleness window | global admin setting (default 96h) | per-position, fixed at mint, validated at mint against the adapter's own declared cadence (Q13) |
| Peg assumption | present, undocumented, unowned | permitted but declared via `pegAssumption()` and surfaced pre-signing |
| Protocol fee | accrued at settlement; needed a unit-mismatch fix | withheld from taker-directed outflow on every path, in the units of that transfer, rounded up |
| Upgradeability | UUPS core, 5-day timelock | core non-upgradeable; accounts immutable; versioning per mint |
| Multi-hop swaps | unsupported (AAPL unswappable) | `bytes32 routeId`, adapter-interpreted |
| Recorded amounts | `putSettlementBalance` as a special case | `Realized` as the general rule |

### 4.3 New risks this design introduces

1. **Per-position deployment gas.** The central economic risk, and the reason mainnet
   issuance was briefly ruled out under v2's schema. **Re-measured against the v3 schema and
   2026 gas conditions; passes on all three chains measured** — see `GAS.md`. The risk is
   not eliminated as a category (a future gas-price regime could reopen it — the 15% rule
   stays the standing test), but it is not live today.
2. **No repair path of any kind for a live position.** Larger than v2's "no upgrade path":
   a broken oracle, venue, condition, or arbiter can now only be exited, not fixed.
   Mitigated by short lifetimes, per-mint versioning, mint-time validation, and the two I3
   paths — but it is the defining posture of v3 and should be stated in the LP-facing docs,
   not just here.
3. **Correctness pressure moves to mint time.** Every parameter that v2 could repair must now
   be right the first time. `maxPriceAge` against feed cadence is the specific case
   (OptionHood's bug #2), and §8.1's refusal to publish a mismatched profile is the control,
   backed now by the Q13 on-chain floor check.
4. **Calldata cost per action rises** as storage cost at mint falls (§1.6). **Measured, not
   assumed: negligible in dollar terms on every chain tested** (`GAS.md`) — but this was a
   real open question until measured, and stays chain-dependent by construction (a future
   chain with expensive calldata posting could reopen it).
5. **The arbiter must self-verify terms** now that it cannot `SLOAD` them (§2.2 step 2). A
   missing check here is a full forgery of the rulebook, not a degradation.
6. **Larger trusted surface.** More modules, each small and stateless, but more of them.
7. **Terms data availability.** The salt trick trades on-chain readability for zero storage,
   and now covers pointers too. Events + IPFS carry the load (`DECISIONS.md` Q8).
8. **Two consenting parties can choose a malicious pointer set** and cannot back out of it
   except by mutual unwind. Inherent to the thesis; bounded by I1 so it can never harm a
   third party.
9. **ERC-6551 registry as an external dependency** on every target chain, now load-bearing
   for the entire agreement rather than just custody. **The only address constant permitted
   anywhere in core** — a project-wide constraint enforced by convention today; a
   grep-based lint for it is a natural Milestone 1 addition alongside the three landed here.
10. **Counterfactual pre-funding** and **signer-set mutation on NFT transfer** (§1.5).
11. **Dust across many accounts** instead of one pool. `SWEEP_DUST` handles it but is
    per-position; remainder-to-LP rounding makes it structurally zero for the position
    assets.

---

## 5. Section (e) — Open questions and assumptions

**Read `DECISIONS.md` for current status.** It is the maintained register (Q1–Q13,
resolved/dissolved/open, each with the reasoning that produced its status). What follows is
retained as narrative background for *why* certain questions closed the way they did — it is
not re-checked for staleness the way `DECISIONS.md` is, and should not be read as the
up-to-date index.

### 5.1 Resolved since v2 (snapshot — see `DECISIONS.md` for anything more recent)

| Q | Resolution |
|---|---|
| **Q1** — who is the arbiter signer | Stateless singleton `ConditionArbiter`, resolving the position's `condition` and delegating (§2.2). Zero keeper liveness requirement. |
| **Q2** — is 2-of-3 fixed or configurable | Dissolved. Fixed, as compile-time constants (§2.5). No `settleThreshold` field. |
| **Q3** — is the LP side transferable | No — static `economics.lp`. Partial capacity management is `reduceCommitment` (§3.7), not transfer. |
| **Q6** — oracle/settlement denomination mismatch | Peg assumption permitted, disclosure mandatory (§3.4). |
| **Q4** — fee base | 1% of taker-directed outflow. Fee rounds up, payout rounds down, remainder to LP — worked examples in `DECISIONS.md`. |
| **Q9** — cross-chain owner resolution | Mode A (co-located) default; mode B opt-in variant; mode C rejected (§6.3). Unchanged by v3. |
| **Q13** — mint-time `maxPriceAge` vs. feed cadence | **New in this revision.** `IPriceOracle.cadenceHint()`, enforced as a mint-time floor. Full reasoning and rejected alternatives in `DECISIONS.md`. |

### 5.2 Still open — see `DECISIONS.md` for status; topic sentence only here

- **Q5 — Is per-position account deployment affordable, on mainnet in particular?**
  Re-measured, not merely re-opened: `GAS.md` passes it on all three chains tested under
  2026 gas conditions. The 15% rule remains the standing test for future gas-price regimes,
  not a one-time question that's now closed forever.
- **Q7 — Multi-LP / partially filled positions.** Unsupported. `reduceCommitment` (§3.7)
  covers partial *fill of an offer*, not multiple LPs backing one position.
- **Q8 — Terms data availability under the salt trick.** Events plus IPFS pinning; no
  on-chain fallback storage (would undo the gas win).
- **Q10 — Corporate actions on collateral held in a TBA.** Needs a live-token test before
  mainnet.
- **Q11 — Salt policy / `createAccount` front-running.** Believed closed by construction;
  needs an explicit regression test, not just the argument.
- **Q12 — Should `PositionManager` be non-upgradeable?** Leaning yes; migration cost for
  `consumedUnits` if not, unresolved.

### 5.3 Assumptions made explicit

- Position durations stay short (hours to days), bounded by the profile's
  `minHours`/`maxHours`. **v3 leans on this harder than v2**: it is the entire argument for
  why immutability is acceptable. If durations lengthen materially, revisit I2.
- Collateral is ERC-20; the receiver hooks are forward-looking, not a supported type.
- Every target chain has, or permits deploying, the canonical ERC-6551 registry *and* a
  deterministic CREATE2 factory at a known address (§6.1).
- An oracle a position points at is an independent price source, not a wrapper around the
  same venue it swaps against. Nothing on-chain enforces this; it is the assumption the
  oracle-derived `minAmountOut` property rests on entirely. It belongs in the curation
  review template so it is checked every time rather than assumed once.
- LP collateral is pulled at mint from a standing approval, never escrowed in advance
  (§3.7). Takers therefore have no on-chain guarantee an LP is good for a fill until the mint
  transaction succeeds; a failed `transferFrom` reverts the mint harmlessly. If a
  pre-commitment guarantee is ever required, it means an LP vault with reserved balances,
  which reintroduces pooled custody on the LP side and cuts against I1.

---

## 6. Multi-chain: replicated stack, local settlement

The hub lives on Ethereum mainnet; issuance and settlement happen on any chain, mainnet
included, by changing the target RPC and the position's `chainId`. This works only if the hub
is deliberately kept **non-load-bearing**. The moment a settlement on chain X has to read
mainnet state, there is a bridge in the critical path of every position. The design below
avoids that entirely.

**Changed from v2:** mainnet is now a first-class execution chain rather than hub-only. v2
concluded L2-only issuance on the strength of a gate that measured the pre-salt schema and
an earlier, higher gas-price era; both are gone. Re-measured under the v3 schema and current
conditions, mainnet passes (`GAS.md`). The commercial reason is decisive — tokenized-asset
liquidity is concentrated on L1, and a protocol that cannot issue where the depth is has
solved the wrong problem.

### 6.1 Replication by address, not by messaging

Deploy the whole stack — `PositionManager`, `FeeVault`, `ModuleRegistry`, the
`PositionAccount` implementation, `AuthzModule`, `ConditionArbiter`, reference conditions —
at **identical addresses on every chain**, via a deterministic CREATE2 factory. The ERC-6551
registry is already address-identical.

That is what makes "just change the RPC" literally true: the app's chain config reduces to
`(rpcUrl, chainId, pointerSet)`. Every contract address is a constant. There is no per-chain
address book, no `NetworkConfig.sol` to edit, no core redeploy.

The one thing that is *not* free: **adapters are chain-specific code.** OptionHood's bug #1
— `ExactInputSingleParams` carrying a `deadline` field the deployed router didn't have — is
exactly the kind of thing that differs per chain and can only be caught by fork-testing
against live state. Adapters must be written and verified per chain. That is the honest
boundary of "no core change per chain."

### 6.2 Why the hub needs no cross-chain read

The mainnet hub holds `ProfileRegistry` (published LP profiles), `ModuleRegistry` (curation
of record), and an `AttestationLog` (reputation, verification evidence). **No contract on any
execution chain reads any of it** — including the mainnet execution stack, which is
deliberately kept separate from the hub contracts so that mainnet issuance is not a special
case in the code.

It works because LP profiles are **self-contained signed EIP-712 blobs** — OptionHood's
existing design, preserved. Verifying a profile on chain X requires a signature check, not
a state read. The hub is a *publication and discovery* layer, the same way an IPFS index is,
and it can be replaced or supplemented without touching settlement.

Replay containment: the EIP-712 domain separator includes the execution `chainId`, and the
profile itself carries an explicit `chainIds` list that the local `PositionManager` checks at
mint (step 1 of §3.6). An LP who wants to quote on three chains signs one profile
enumerating three chain IDs; an LP who wants one chain enumerates one. A profile can never
be replayed onto a chain the LP didn't name — which matters a lot, because pointer addresses
that are safe on one chain may be unrelated contracts on another.

One consequence of `reduceCommitment` (§3.7) worth flagging: `consumedUnits` is **per chain**,
because it is local state. An LP publishing one profile across three chains is offering
`totalUnits` on *each* of them, not `totalUnits` in aggregate, and must reduce on each chain
separately. This is the correct behaviour for a design with no cross-chain read, but it is a
sharp edge for LPs and the app must display per-chain remaining capacity rather than a single
number.

### 6.3 Where the NFT lives — the one genuine trade-off

The ERC-6551 registry takes `chainId` as part of the binding tuple, so an account on chain X
can be bound to an NFT on mainnet at a deterministically derivable address, with no bridge.
That much is free. What is **not** free is the account *resolving the current owner* of a
foreign-chain NFT — the standard is explicit that cross-chain accounts need external
machinery for this.

| Mode | NFT on | Account on | Owner resolution | Added trust | Latency |
|---|---|---|---|---|---|
| **A. Co-located (default)** | chain X | chain X | direct `ownerOf` | none | none |
| **B. Mainnet-anchored, proved** | mainnet | an L1-settling L2 | Merkle-Patricia proof of the `_owners` slot against an L1 block hash from the L2's own predeploy | none for validity; depends on the L2's L1-view liveness | the L2's L1-view lag |
| C. Mainnet-anchored, attested | mainnet | any chain | bridge message or signed attestation | a bridge or attester per position | messaging |

**Recommendation: A as the default, B as an opt-in account-implementation variant, C
rejected.** (Q9, `DECISIONS.md`, unchanged by v3.)

A is what ships first, and with mainnet issuance back in scope it now covers the
mainnet-assets case directly: NFT and account both on mainnet, settling against mainnet
liquidity, no proofs and no variant needed. Mode B's remaining purpose is narrower than v2
implied — it is for a position whose *NFT* should be mainnet-tradeable while settling against
L2 liquidity, which is a real but secondary case.

B's native lever is that **`implementation` is part of the address derivation** — so shipping
`ProofOwnedAccount` alongside `SameChainAccount` requires no registry change, no flag, and no
core change. Choosing the variant at mint *is* choosing a different address. Mechanics: the
account caches a proven owner plus an `ownerEpoch`; a fresh proof is required only when
ownership changes, not per settlement, so the per-action cost is unchanged; a stale proof
blocks *taker* settlement while leaving `SETTLE_TO_LP` and `MUTUAL_UNWIND` untouched, so I3
survives. Milestone 0 priced the proof at roughly 250k gas — on an Orbit chain that is
fractions of a cent, so B is gated on which chains expose a trustworthy L1 block hash, not on
cost. Milestone 5 finding.

C is rejected on principle: it makes a bridge a custody dependency for every position, which
is the largest single source of loss in cross-chain DeFi.

### 6.4 Resilience properties this buys

- **No hub dependency at settlement.** Mainnet hub contracts can be congested or paused;
  positions on chain X settle normally.
- **No bridge or messaging anywhere in the critical path** (mode A; mode B uses only the
  L2's own trust-minimized L1 view).
- **No keeper liveness requirement.** The arbiter is stateless and permissionless to invoke
  (§2.2), and no planned condition needs a TWAP or commit-reveal.
- **Permissionless account materialization.** `createAccount` is callable by anyone, so a
  position's account can be brought into existence without the protocol's cooperation — and
  in v3 a pre-deployed account is harmless by construction, not merely by guard (§3.6).
- **Per-chain fault isolation.** A compromised adapter, oracle, or chain affects only
  positions on that chain, and within that chain only positions pointing at it (I1).
- **Oracle-free LP recovery** and **LP+taker terminal unwind** (I3) — now the only two
  remedies, so both are treated as safety-critical, and I3's oracle-independence is now
  empirically measured, not just argued (§0, `GAS.md`).

What v3 gives up relative to v2, stated in the same place for symmetry: **in-place repair.**
A position whose venue goes illiquid mid-flight must be unwound or run to expiry rather than
repointed.

### 6.5 Fees are local, and should stay local

Fees accrue on the execution chain, in that chain's settlement asset, into a `FeeVault` at
the same deterministic address everywhere. **Do not try to route them to mainnet.** Bridging
protocol revenue means running a bridge, which reintroduces the dependency §6.3 rejects, for
the sake of accounting convenience. (Mainnet-issued positions accrue fees to the mainnet
vault, which needs no bridge by definition — a small side benefit of §6's scope change.)

Governance withdraws per chain. If a consolidated view is wanted, the mainnet
`AttestationLog` can hold *reported* per-chain totals for reporting purposes, clearly marked
as unverified accounting rather than claims on funds. Withdrawal authority is the one thing
that must be configured per chain rather than derived — flag it in the deployment runbook, or
accept a per-chain fee-recipient constant baked into the vault at deploy.

---

## 7. Chain/asset generality checklist

### 7.1 Support matrix — what "any asset, any chain" actually means

Core bytecode is asset-agnostic and chain-agnostic. Adapters are not, and never will be.
The generality claim is precisely: **onboarding costs one oracle adapter, one venue adapter,
and a fork-test run — never a protocol change.** Everything below is the boundary of that
claim.

**Collateral and settlement assets.** Any ERC-20 that clears all six rows:

| Requirement | Status | Where handled |
|---|---|---|
| Implements `decimals()` | **required** — queried and pinned at mint, never assumed; tokens without it cannot be onboarded | §3.6 step 5 |
| Does not gate transfer recipients by **allowlist** | **hard no-go.** Denylists (`paused()`/`isBlocked()`, as OptionHood found) are fine — fresh accounts pass them. An allowlist breaks per-position custody outright, since every mint needs a never-before-seen recipient approved on demand | §7.3 step 3; fallback is Q5(b) |
| A price oracle exists for the **pair**, or a declared peg makes one usable | **required**, and the peg case must be declared via `pegAssumption()` | §3.4, and the §5.3 independence assumption |
| A venue route exists with real depth | **required.** Pool existence is not liquidity — OptionHood onboarded three tickers and only one was tradeable. In v3 this must be checked **before** mint, since an illiquid venue can no longer be repointed away from | §8.2 pre-trade check |
| Fee-on-transfer | **supported** — inbound amounts are measured as `balanceAfter - balanceBefore`, never the requested amount | §3.6 step 10 |
| Rebasing / ERC-8056 corporate actions | **unverified.** Interacts with `Realized`; needs a live split or dividend before mainnet | `DECISIONS.md` Q10 |

The distinction that matters operationally: *onboarded* ≠ *tradeable*. Rows 3 and 4 are
liquidity and infrastructure facts about a specific chain at a specific time, not properties
of the token, and they change. Re-check them per chain, not once per asset.

**Chains.** Any EVM chain meeting all four:

| Requirement | Note |
|---|---|
| Canonical ERC-6551 registry present, or permissionlessly deployable | verified in §7.3 step 1; abort if neither. Load-bearing for the entire agreement in v3, not just custody |
| Deterministic CREATE2 factory at a known address | this is what makes address-identical replication — and therefore "just change the RPC" — true |
| Opcode support matching the compile target | OptionHood's fourth finding in reverse: keep `evm_version` at `cancun` or later and confirm the chain's execution environment accepts it |
| Chain-specific oracle and venue adapters, fork-verified against live ABIs | the only genuine per-chain work, and unavoidable — OptionHood's bug #1 is exactly this class |

Ethereum mainnet meets all four and is now an in-scope execution chain (§6), **and passes
the §9.0 gate** (`GAS.md`).

Not supported: non-EVM chains. Out of scope entirely — the design is ERC-6551, ERC-20, and
EVM address derivation from top to bottom.

**Narrower than "any chain": mode B.** §6.3 mode A is the genuinely chain-agnostic
configuration. Mode B additionally requires an L1-settling L2 that exposes a trustworthy L1
block hash to contracts. That is a meaningful subset of EVM chains, not all of them. Do not
let "any chain" in a pitch deck quietly mean mode B.

### 7.2 Prohibitions as CI lints

Prohibitions are testable, so make them CI lints. Twelve rows existed at Milestone 0; v3
adds three (marked **new**), **all three now implemented and self-tested**
(`script/lints/`), not just specified.

| Prohibition | Enforcement |
|---|---|
| No hardcoded chain ID | grep numeric literals near `chainid`; `block.chainid` only in digests and the profile check |
| No hardcoded decimals | grep `1e18`, `1e6`, `1e8`, `1e20` outside adapter normalization and fixtures; all scaling derives from pinned decimals |
| No assumed `decimals()` success | `staticcall` + explicit revert at mint |
| No hardcoded token addresses in core | core has zero address constants except the ERC-6551 registry |
| No venue calldata shape in core | core knows only `ISettlementVenue`; router struct shapes live in one adapter |
| No assumed oracle decimals | adapter normalizes to 1e18; `oracleId()` records what was verified |
| No assumed feed cadence | `maxPriceAge` per position, validated at mint against the adapter's declared cadence (Q13, now enforced) |
| No assumed transfer semantics | inbound amounts always `balanceAfter - balanceBefore` |
| No cross-chain state read in the settlement path | grep for any hub address in account/module code — there should be none (mode A) |
| No `balanceOf` in settlement math | `Realized` only; §1.5 |
| No `DELEGATECALL`/`CREATE`/`CREATE2` in account paths | grep opcodes and `operation != 0` |
| No threshold below 2 on any settle path | assertion in `policyFor` |
| **new, implemented** — no `SSTORE` of any term in `PositionAccount` | `script/lints/no-term-sstore.sh` — diffs `forge inspect <contract> storage-layout` against the `{realized, accountState}` allowlist; self-tested against a deliberate violation (`test/lints/fixtures/BadFixtures.sol`) |
| **new, implemented** — no `SLOAD` of terms in `ConditionArbiter` or any `ICondition` | `script/lints/no-term-sload.sh` — asserts an empty storage layout (stronger than "no term field": these contracts must be fully stateless); self-tested |
| **new, implemented** — no `REPOINT`-shaped mutator anywhere | `script/lints/no-repoint-mutator.sh` — greps for pointer-field dot-notation assignment and suggestively-named setter functions; self-tested |

Run all three via `script/lints/run-all.sh`; verify the lints themselves via
`script/lints/self-test.sh` (checks both the clean-code pass case and the fixture-violation
fail case for each).

### 7.3 Per-chain onboarding runbook (replaces `NetworkConfig.sol`)

1. Verify the deterministic CREATE2 factory and the ERC-6551 registry are present at their
   canonical addresses; deploy if permitted, abort if not.
2. Deploy the stack via the factory; assert every address equals the reference address **and
   that `extcodehash` matches.** Same address is not same code, and §6.1 leans on exactly
   that. A mismatch means a divergent constructor or compiler and must fail the deploy.
3. **Per asset: does the token gate transfer *recipients*, and by denylist or allowlist?**
   OptionHood found `paused()`/`isBlocked()` — a denylist, which fresh accounts pass. An
   allowlist is a hard no-go for per-position custody. Go/no-go per asset, not a code fix; if
   an important asset is allowlist-gated, fall back to Q5(b) per-LP-profile accounts.
4. Deploy oracle and venue adapters for that chain's actual infrastructure, including
   `pegAssumption()` and cadence declarations (`cadenceHint()`).
5. Verify each adapter's encoding against the deployed target's **real ABI**, pulled from the
   chain, not from documentation.
6. Fork-test end to end: mint, real swap against a real pool, settle both directions,
   mutual unwind, and an expiry recovery with a deliberately reverting oracle. (This project's
   own gas-gate cost model already runs the reverting-oracle case in isolation — `GAS.md` —
   though that is not a substitute for a real fork test against live infrastructure.)
7. Publish a pointer set and, optionally, propose curation on the hub (5-day timelock),
   attaching the verification evidence, the oracle-independence attestation from §5.3, and the
   peg disclosure from §3.4.
8. Add the chain to the app's `(rpcUrl, chainId, pointerSet)` config. No contract changes.

Steps 5 and 6 are where OptionHood found three real bugs that 61 passing unit tests missed.
They are not optional.

---

## 8. Companion app scope

A config and deployment aid. Explicitly **not** a no-code contract generator.

v3 raises the app's importance in one specific way: because nothing can be repaired after
mint, **the pre-signing surface is the only place a bad configuration can be caught.** What
was a convenience in v2 is a control in v3.

**In scope**

1. **Terms builder with risk assessment.** Guided construction of a profile: curated
   pointers by default, free-text addresses only behind an explicit unverified
   acknowledgement that lands in the signed profile; set duration and pricing bounds,
   `maxPriceAge`, `slippageBps`; enumerate the chain IDs the profile is valid on; sign
   EIP-712; publish to the hub and IPFS. **Must display, before signing:** the oracle's
   declared peg assumption (§3.4), whether `maxPriceAge` matches the feed's cadence (now
   also a contract-enforced floor, Q13), the venue's measured depth against the profile's
   max notional, and a plain statement that these terms cannot be changed after mint.
2. **Pre-trade liquidity check.** Call `venue.quote()` and compare to `oracle.price()`;
   **refuse to publish** a profile whose route cannot fill its own max notional within
   `slippageBps`. This is the direct fix for OptionHood's situation where two of three
   onboarded tickers were untradeable and only the spec knew — and in v3 it is the last
   line of defence, since an illiquid venue cannot be repointed away from.
3. **Settlement quoting, net of fee.** Compute and display the taker's payout **after** the
   1% withholding, and populate `minPayoutToTaker` from the displayed figure (§3.8). Quoting
   gross would make every settlement appear to shortfall by 1%.
4. **Account inspector.** Given a `positionId`: derive the account address, verify both
   structs against it, show realized amounts, live balances, and **which actions are
   currently authorizable and why not** — e.g. "taker settlement blocked: oracle stale 4h,
   `maxPriceAge` is 1h; your options are mutual unwind with the LP, or waiting for expiry."
   Under a threshold model, "why can't I settle?" is otherwise opaque, and an opaque answer
   to that question is what makes people believe their money is stuck. v3's version must be
   blunter than v2's, because "repoint the oracle" is no longer among the answers. **For a
   router-backed position** (`economics.lp` matches a known `LPRouter` deployment, §3.9):
   additionally show the backer breakdown (`LPRouter.backerAllocationsOf`) and each backer's
   withdrawable balance (`claimable`) — and that `MutualUnwind`/`SweepDust`/`RawExecute` are
   unavailable for this position by design (§3.9), not a bug.
5. **Capacity manager.** Show per-chain remaining capacity (`totalUnits - consumedUnits`,
   per §6.2's sharp edge) and drive `reduceCommitment` / `invalidateProfile` (§3.7).
6. **Multi-LP matching (new, §3.9, Milestone 7).** The taker-facing slider UX: given a
   requested size and duration, aggregate currently-available, signed `ILPRouter.BackerQuote`s
   (capacity per quote is on-chain via `LPRouter.consumedUnitsForQuote`/`quote.maxUnits` —
   the router-backed analogue of `PositionManager.consumedUnits`/`totalUnitsOf`, not the same
   mappings), sort by `pricePerUnitPerHour` ascending, greedily fill up to
   `LPRouter.MAX_BACKERS` (8) sources, and display the resulting weighted premium **before**
   the taker commits — matching-and-routing logic lives entirely here, not on chain; the
   contract only re-verifies (signature, terms, bounds, capacity) and executes whatever
   allocation the app already decided on, never trusting the app's arithmetic. Must show the
   same pre-signing disclosures as item 1 (peg assumption, `maxPriceAge` vs. cadence, venue
   depth) plus, specific to this flow, that `MutualUnwind`/`SweepDust`/`RawExecute` will not
   be available on the resulting position.
7. **Chain-onboarding aid.** Given a chain and a list of `(asset, oracle, venue, route)`
   tuples, emit a parameterized Foundry deploy script, the §7 verification checklist, and a
   diff-able curation proposal payload. Templates over generation.
8. **Terms archival.** Pin `Economics` **and** `Pointers` to IPFS at mint, always, so the
   §3.2 data availability dependency never becomes load-bearing by accident. `DECISIONS.md`
   Q8 notes that a position whose terms are entirely lost is unspendable, so treat this as
   mandatory rather than best-effort, and verify the pin succeeded before reporting the mint
   as complete.

**Out of scope**

- Generating or compiling adapter Solidity from a UI. Adapters encode chain-specific ABI
  quirks and must be human-written and human-audited.
- Custody of key material.
- Acting as the arbiter or a keeper. §2.2 means no off-chain liveness is required; the app
  must not quietly become a dependency.
- A repoint coordinator. v2's highest-leverage new surface; deleted with `REPOINT`, and now
  CI-guarded against regressing (`script/lints/no-repoint-mutator.sh`).

---

## 9. Foundry-first build plan and the gas gate

Interfaces and tests before implementation.

### 9.0 Milestone 0′ — re-gate the v3 schema — **COMPLETE**

Milestone 0 was complete against v2's schema: interfaces and structs with full NatSpec, the
error and event catalogue, twelve self-tested §7.2 lints, and a gas gate run against real
canonical ERC-6551 registry bytecode. Its verdict — mainnet fails at every gas price, L2s pass
by roughly 100× — measured a design that no longer exists (`GAS-v2-ARCHIVED.md`).

**Milestone 0′ re-ran it against the v3 schema.** Schema deltas applied: `Pointers` into the
salt and out of storage; `initialPointersHash` deleted; `pointersHash` out of the digest;
`settleThreshold` never added; `minPayoutToTaker` added to `SettleToTakerParams`;
`ICondition.check` loses its separate `Pointers` argument; `pegAssumption()` and
`cadenceHint()` added to `IPriceOracle` (Q13, resolved); `consumedUnits` and
`reduceCommitment` added to `PositionManager`. All declared in `src/` — see that directory
for the actual interfaces, types, and `TermsLib`.

**Mint and per-action costs, reported separately, per chain** (as required, so the §1.6
calldata-vs-storage trade can't hide): mainnet, an OP-stack L2 (Base, live-queried), and an
Arbitrum Orbit chain (execution live-queried; L1 data cost modeled — see `GAS.md` for why).
Snapshotted: `mint` (CALL), `mint` (PUT including creation swap), `settleToTaker`,
`settleToLp`, `settleToLp` with a reverting oracle, `mutualUnwind`. There is no `repoint` row
any more.

**Decision rule, applied as committed in advance:** 15% of a representative premium, per
chain, premiums fixed *before* the benchmark ran (`GAS.md`'s pre-registration section,
timestamped and written before `GasGateTest` executed). **Result: PASS on all three chains**,
by margins of roughly 5×–79× depending on chain and action — see `GAS.md` for the full table,
the methodology (what's live-measured vs. modeled, and why), three bugs found and fixed while
building the cost model (logged so "fixed until it ran" stays distinguishable from "tuned
until it passed"), and two substantive findings: the §1.6 calldata trade does not bite under
2026 L1 data pricing, and OP-stack L1 cost tracks calldata compressibility rather than raw
byte count.

Prior-run context, for comparison rather than as a target: v2's worst-case lifecycle overhead
was +254,324 gas (94%), with the lean-pointer variant at +166,351 (`GAS-v2-ARCHIVED.md`).
Deleting five cold `SSTORE`s removed roughly 110k from mint, consistent with the measured
`mint` (CALL) figure once accounted against that estimate.

**The gate has passed. Milestone 1 may begin.**

### Milestone 1 — Authorization primitive in isolation — **COMPLETE**

2-of-3 with each pair of slots; below-threshold rejection; duplicate-slot rejection; ECDSA
malleability; ERC-1271 signer accepted; ERC-1271 signer returning a wrong magic value
rejected; digest binding (an arbiter approval for action A rejected for action B); replay
after a `state()` bump; replay after a `signerEpoch` bump; expired `deadline`; cross-chain
digest rejected; cross-account digest rejected; `policyFor` asserting no settle path below
threshold 2; **`eligibleSlotMask` — an arbiter approval for `MUTUAL_UNWIND` rejected even
when it would otherwise make quorum**; and the v3 headline, **`ConditionArbiter` rejecting a
`ctx` whose `Economics`/`Pointers` do not re-derive to `ctx.account`** (§2.2 step 2 — the
rulebook-forgery hole, and the most important test in this milestone). The Milestone 0′ cost
model's `ConditionArbiter` stand-in omits digest step 1 (recompute-and-compare) for
cost-model simplicity (`GAS.md`); the real Milestone 1 implementation does not.

**Delivered:** `src/AuthzModule.sol` and `src/ConditionArbiter.sol`, real production
implementations (not cost models), plus `src/libraries/DigestLib.sol` (the shared §2.4
digest, extracted so both `ConditionArbiter` and the future `PositionAccount` compute it
identically). Tests: `test/unit/AuthzModule.t.sol` (16 tests) and
`test/unit/ConditionArbiter.t.sol` (6 tests), every scenario in this milestone's list
covered, 22/22 passing, written before the implementation per the repo's TDD workflow (red,
then green). Both contracts pass `script/lints/no-term-sload.sh` — fully stateless, as
specified.

**Two real design questions this milestone resolved, not just implemented:**

1. **`IAuthzModule.signerSlots` needed the full `ActionContext`, not just `account`**,
   confirming the Milestone 0′-era interface fix was correct and load-bearing rather than
   cosmetic — the real `AuthzModule` genuinely has nothing else to resolve `lp`/`arbiter`
   from.
2. **Where deadline enforcement lives.** Not specified by any prior section as belonging to
   a particular contract. Placed in `AuthzModule.requireQuorum` (checked first, before any
   signature verification runs) rather than in the account: an expired authorization
   shouldn't satisfy quorum regardless of whether the individual signatures are valid, and
   this keeps the check in the one place that already evaluates "is this authorization
   satisfied" as its entire job. `IAuthzModule.DeadlineExpired` is the new error.
   `BelowThreshold`/`DuplicateSlot`/`SlotNotEligible`/`BadApproval` also moved from being
   locally declared inside the Milestone 0′ `MockAuthzModule` cost model to being declared
   on the `IAuthzModule` interface itself (same signatures, no cost-model behavior change) —
   the natural consequence of the interface now having a real second implementation that
   needs the same errors.

### Milestone 2 — Conditions — **COMPLETE**

Per condition, against a mock oracle: profitable / unprofitable / exactly break-even; fresh /
stale / `updatedAt` in the future; pre- and post-expiry boundaries at exactly `expiry`;
payout figures in `ctx` mismatching recomputation; **payout below `minPayoutToTaker` rejected**
(§3.8); **`ExpiryCondition` with a reverting oracle must still pass** (the I3 regression test
— already run once, informally, in the Milestone 0′ cost model, with an identical-gas result;
Milestone 2 makes it a real, permanent regression test against the real implementation);
`DustCondition` refusing the position assets.

Carried gotcha from Milestone 0, reconfirmed in `foundry.toml`: under `via_ir` the optimizer
treats `TIMESTAMP` as movable and can collapse several `block.timestamp` reads in one test
function into a single pre-`vm.warp` read, silently producing expired deadlines. Test-side
deadlines must go through `vm.getBlockTimestamp()`. This bit precisely here, where
expiry boundaries are tested at exactly `expiry` — every timestamp in
`test/unit/TakerProfitCondition.t.sol` and `test/unit/ExpiryCondition.t.sol` is read via
`vm.getBlockTimestamp()` immediately before use, never cached across a `vm.warp`.

**Delivered:** `src/conditions/{TakerProfitCondition,ExpiryCondition,DustCondition,
NeverCondition}.sol`, all real, all stateless (`no-term-sload.sh`). 23 tests across four
files in `test/unit/` (13 + 5 + 3 + 2), every scenario in this milestone's list covered, all
passing. Fresh
`test/unit/mocks/MockPriceOracle.sol`, deliberately separate from `test/gas`'s cost-model
oracle so nothing here can retroactively touch `GAS.md`'s numbers.

**One correctness finding, caught by running the tests, not by inspection:** the first
draft of `TakerProfitCondition`'s recomputed-payout formula mixed a 1e18 fixed-point price
delta with raw settlement-asset units without rescaling by `10**settlementDecimals` — the
exact decimal-scaling bug class this project's own rules exist to catch, and the same class
of bug the Milestone 0′ cost model hit once already (`GAS.md`'s bug log). Fixed before any
test result was recorded; see the formula and its NatSpec in
`src/conditions/TakerProfitCondition.sol`.

**One robustness finding, made while implementing this milestone, not before:**
`ConditionArbiter.isValidSignature` (Milestone 1) called `ICondition.check()` with no
try/catch. Since `ICondition` implementations are third-party and pluggable per position
type (§3.5), and only curated ones are reviewed, a buggy or malicious uncurated condition
that reverts would have broken `ConditionArbiter`'s own MUST-NOT-REVERT ERC-1271 contract.
Fixed retroactively in `src/ConditionArbiter.sol`: a revert from `check()` is now caught and
treated as a rejection, proven by a dedicated test
(`test_isValidSignature_revertingCondition_treatedAsBadValue_doesNotRevert`) against a
fixture condition that always reverts. All of Milestone 1's original 23 tests still pass
unchanged.

### Milestone 3 — Account — **COMPLETE**

Raw `execute` reverts from the NFT owner, the LP, and the arbiter; succeeds from the authz
module with 3-of-3 after the delay and reverts before it; `DELEGATECALL`/`CREATE` rejected on
every path; `isValidSigner` returns `0` for the owner; **passing a mutated `Economics` or
`Pointers` struct reverts because the re-derived address doesn't match `address(this)`**
(§3.2); **an account pre-deployed by a stranger before mint is fully functional and
indistinguishable** (the v3 replacement for v2's `initialize` guard tests); a pre-funded
counterfactual account settles using `Realized` and not `balanceOf`; fee-on-transfer
collateral records the received amount; unexpected ERC-721/1155 rejected; **`feeBps` withheld
on `MUTUAL_UNWIND` exactly as on `SETTLE_TO_TAKER`**, rounded up (the I4 test); no `SSTORE` of
any term anywhere (the §7.2 lint, now runnable via `script/lints/no-term-sstore.sh` against
the real implementation, not just the cost model).

**Delivered:** `src/PositionAccount.sol` — the contract that actually holds collateral.
24 tests (`test/unit/PositionAccount.t.sol`), covering every item in this milestone's list
against the REAL `AuthzModule`, `ConditionArbiter`, and all four Milestone 2 conditions —
no stubs standing in for anything with a real implementation. `MockPositionManager`
(`test/unit/mocks/`) provides just enough ERC-721 + `signerEpochOf` surface for isolation,
since `PositionManager` itself is still Milestone 4.

**Findings from actually building the fund-custody contract, not assumed away by the
Milestone 0′ cost model that explicitly deferred them:**

1. **The cost model's `settleToTaker` swapped the ENTIRE recorded balance and paid it all
   to the taker — a real financial bug had it been carried into this contract, not merely a
   simplification.** The real implementation branches correctly on `economics.optionType`
   (DECISIONS.md's P&L table): CALL swaps only the profit portion of the held collateral,
   transferring the unswapped remainder to the LP directly; PUT pays the taker directly from
   the already-settlement-denominated `recordedSettlement` (no swap for the taker) and swaps
   only the LP's remainder back to collateral. Confirmed algebraically and by test: the LP
   always recovers exactly their entry-price notional in current-price terms, the taker gets
   exactly the profit, net of the I4 fee.
2. **`recordMint`/`initialSwapAndRecord` needed real access control, or "pre-deployment by a
   stranger is harmless" (§3.6) would have been false.** `Realized` is separate, mutable
   storage from the account's address-derived terms — a stranger who permissionlessly
   pre-deploys the counterfactual account (§1.4, by design) could otherwise call `recordMint`
   first with garbage values, corrupting the position before the real mint ever happens.
   Closed using `ERC6551AccountLib.token()` (the real reference library, `lib/erc6551-reference`)
   to read the account's own immutable, registry-appended `(chainId, tokenContract, tokenId)`
   tuple — unspoofable, since it's baked into the account's bytecode at CREATE2 deployment,
   not passed as trustable calldata — gating both functions to the real `positionManager`
   and to a single write, ever. Proven by test, including the adversarial ordering (stranger
   pre-deploys and fails to corrupt it, then the real mint flow succeeds normally after).
3. **`sweepDust` needed its own account-level guard against sweeping the position's own
   collateral/settlement asset — not solely `DustCondition`'s job.** A direct LP+taker 2-of-2
   approval never routes through `ConditionArbiter` (and therefore never invokes
   `DustCondition`) at all. Without an independent, unconditional check in the account
   itself, that path would have let the two parties jointly drain the position's REAL
   assets with none of `MutualUnwind`'s I4 fee applied — structurally worse than the
   already-documented off-chain side-payment evasion (§3.6), since it would require no
   off-chain trust at all. Fixed before any test was written against it.
4. **A real ABI/security tension in `IERC6551Executable.execute`, resolved rather than
   glossed over.** ARCHITECTURE.md §1.2 describes its gate as "relocated to authzModule" —
   but `AuthzModule` is a stateless, view-only predicate (its own NatSpec) that never itself
   becomes `msg.sender` anywhere in this system, and the standard `execute(address,uint256,
   bytes,uint8)` ABI has no room to carry `ActionContext`/`SlotApproval[]` at all. There is
   no way to make that function both standard-conformant and safely callable. Resolution:
   `execute()` is implemented but unconditionally reverts for every caller (proven by test,
   `AuthzModule` included via an impersonated `vm.prank`); `rawExecute` — with its full
   `ActionContext`/quorum/delay machinery — is the real, reachable raw-call path. Documented
   in `execute()`'s own NatSpec so this isn't mistaken for an oversight later.
5. **Confirmed by test, not just by design intent: under the standard `ConditionArbiter` +
   `NeverCondition` wiring, `RAW_EXECUTE` can never reach 3-of-3 quorum at all**, since the
   arbiter's own approval always fails `NeverCondition`. It is only reachable when a
   position's `pointers.arbiter` is some other signer willing to directly co-sign (a human
   overseer, a multisig) — a legitimate but deliberately rare configuration, matching §2.2's
   default-deny intent for this action rather than contradicting it.
6. **A genuine Yul stack-too-deep, hit even under `via_ir = true`,** once `TermsLib`'s
   20-argument `abi.encode` got inlined into `PositionAccount`'s larger functions. Fixed by
   passing `Economics`/`Pointers` as structs directly to `abi.encode` rather than exploding
   every field — byte-identical output (both structs are entirely static types, so
   ABI-encoding the struct is exactly the concatenation of encoding its fields individually),
   confirmed by every pre-existing Milestone 1–2 digest/salt-dependent test continuing to
   pass unchanged after the change.
7. **`IPositionManager` gained `signerEpochOf(uint256)`.** `DigestLib`'s own NatSpec already
   flagged that the account must verify `ctx.signerEpoch` against a live value before
   trusting a digest, deferring the mechanism to "the account's responsibility — Milestone
   3." There was no getter to check it against until this milestone added one — closed here,
   not carried forward as a known gap.

### Milestone 4 — Integration, mocks — **COMPLETE**

Full lifecycle both option types, both directions; `MUTUAL_UNWIND` pre- and post-expiry;
expiry with an oracle that reverts; mint rejected when pointers don't match the profile's
committed set; mint rejected for a chain not in the profile's `chainIds`; mint rejected when
`consumedUnits + units > totalUnits`; `reduceCommitment` narrowing only, rejected below
`consumedUnits`, and **live positions unaffected by it**; uncurated pointers rejected without
both acknowledgements; **curation removal has no effect on a live position** (§3.5);
`minPayoutToTaker` reverting a shortfall settlement end to end; **mint rejected when
`maxPriceAge < oracle.cadenceHint()`** (Q13, new).

**Delivered:** `src/PositionManager.sol` — the ERC-721 ledger, EIP-712 profile
verification, and mint orchestrator. 20 tests (`test/unit/PositionManager.t.sol`), every
scenario in this milestone's list covered end to end through the real `PositionAccount`,
`AuthzModule`, `ConditionArbiter`, and all four conditions — no stubs left standing in for
anything with a real implementation as of this milestone.

**Real gaps this milestone's design work found and closed, none of them cosmetic:**

1. **A latent precision bug in `TakerProfitCondition` (Milestone 2) and `PositionAccount`
   (Milestone 3), both.** Both computed `wholeUnits = (units * unitScalarNum) /
   unitScalarDen` as a truncated INTERMEDIATE integer before using it in the payout/swap
   formulas. Every test through Milestone 3 used `units=10, unitScalarNum=1,
   unitScalarDen=10` (`wholeUnits == 1` exactly), which never exercised the truncation — a
   fractional position (`units=5` against the same scalar, representing half a share) would
   have silently computed a payout of **zero** regardless of price movement. Found while
   reasoning through the mint-time collateral formula for this milestone, before writing a
   single line of `PositionManager`. Fixed in both files by deferring the division by
   `unitScalarDen` to the same final division as the other scale factor, so there is only
   ever one truncation, at the end — confirmed by dedicated regression tests in both
   `test/unit/TakerProfitCondition.t.sol` and `test/unit/PositionAccount.t.sol` proving a
   half-share position now pays out exactly half, not zero.
2. **`LiquidityProfile` had no source for `Economics.unitScalarNum`/`unitScalarDen`, and
   `mint()` had no way for a taker to choose CALL vs. PUT under a `supportsOptionType ==
   BOTH` profile.** Both are real, necessary fields/parameters this milestone's design work
   added — `Economics`'s own generalization of contract unit multipliers (`1/100` standard: 1 Unit = 0.01 Asset)
   (§3.3) had nothing upstream supplying a value until now.
3. **`reduceCommitment` needed to know the profile's CURRENT `totalUnits`, but
   `PositionManager` never stores the full profile — only its hash, an owner, and
   `consumedUnits`.** `reduceCommitment(bytes32, uint256)` only ever receives a hash on
   later calls, with no way to re-derive `totalUnits` from that alone. Added
   `totalUnitsOf[profileHash]`, set once at first use (mint or `invalidateProfile`) and
   narrowed thereafter — separate from the immutable, never-stored original profile.
4. **The PUT creation-time swap (§3.6 step 12) had no real `minAmountOut` — an earlier draft
   passed `0`,** which is exactly the "trust the venue's own quote" failure mode §3.4 exists
   to rule out everywhere else. Fixed: the same oracle-derived-minus-`slippageBps` formula
   used at settlement now applies at the PUT creation swap too, computed from the same live
   `oracle.price()` read already required for `entryPrice`.
5. **The protocol fee's source was never pinned down before this milestone.** §0's thesis
   states the protocol "takes 1% of profitable settlement" as a fixed promise, and I4 says
   "the fee is a term of the position, not an admin knob" — read together, `feeBps` is a
   **fixed protocol-wide constant** (`PositionManager.FEE_BPS = 100`), baked into `Economics`
   at every mint, not an LP-chosen `LiquidityProfile` field and not admin-configurable on a
   live position. Both "a term of the position" and "always the same value" are true
   simultaneously; this resolves what could otherwise read as a contradiction.
6. **Unlike `TermsLib`'s 20-argument `abi.encode` (Milestone 3's stack-too-deep), the
   `LiquidityProfile` EIP-712 hash (22 arguments, including a dynamic `chainIds` array) could
   not use the same struct-passing shortcut** — `LiquidityProfile` mixes static and dynamic
   fields, and EIP-712 requires the dynamic ones (the array) to be hashed separately from the
   static ones, which rules out passing the whole struct to one `abi.encode` call. Avoided
   preemptively by decomposing `mint()` into many small, single-purpose internal functions
   from the start (signature/lifecycle/bounds/capacity/economics/transfers each isolated)
   rather than writing one large function and discovering the same wall again — it compiled
   cleanly on the first attempt.

### Milestone 5 — Fork tests against live chain state — **COMPLETE (Base only)**

Non-negotiable, per OptionHood's experience. Per target chain: verify every adapter's
encoding against the deployed contract's real ABI; fund test accounts by impersonating a real
holder and calling `transfer` (**never `deal()`** — OptionHood's bug #3); assert the
deterministic stack addresses and `extcodehash` match the reference; mint against a real pool;
execute a real swap; settle; mutual unwind. Keep `evm_version = "cancun"` with the comment
explaining OptionHood's fourth finding (`foundry.toml`).

**Delivered:** `src/adapters/ChainlinkPriceOracleAdapter.sol` (real `AggregatorV3Interface`,
peg disclosure per §3.4), `src/adapters/UniswapV3VenueAdapter.sol` (real `SwapRouter02`, ABI
confirmed against the live selector, not the older `ISwapRouter` shape), and
`test/fork/BaseFork.t.sol` — 3 tests, pinned to Base block `49_329_963`, all three human-written,
against real deployed infrastructure (the canonical ERC-6551 registry, a real WETH/USDC pool,
the real router, the real ETH/USD feed), no mocks anywhere in the path:

- Mint a PUT — a **real Uniswap V3 swap executes**, converting 1 real WETH into real USDC
  (1 WETH → 1,922,481,864 raw USDC, ≈ $1,922.48) — then recover it post-expiry via
  `settleToLp` (I3).
- Mint a CALL (no swap at creation), then `mutualUnwind` it, with the real I4 fee landing on
  real WETH.
- Against genuinely live, unmanipulated oracle data, an at-the-money `settleToTaker` is
  correctly rejected — not a mock returning a canned zero-pnl scenario.

**Real gaps this milestone's work found and closed:**

1. **Toy private keys collide with real deployed contracts on a live chain.** The original
   draft used the textbook toy keys (`0xA11CE`/`0xB0B`) for `lp`/`taker`. `0xB0B`'s derived
   address already has real bytecode deployed on Base mainnet — every mint reverted with
   `ERC721: transfer to non ERC721Receiver implementer` because that address is a contract,
   not an empty EOA. Confirmed via `cast wallet address` + `cast code` against the live chain
   before fixing. Fixed by switching to `makeAddrAndKey("lp")` / `makeAddrAndKey("taker")` and
   re-verifying the derived addresses carry zero code. Toy keys are safe on a local Anvil
   chain with no real state behind them; they are not safe once the test forks a live chain.
2. **The `via_ir`/`TIMESTAMP`-movable gotcha (already documented in `foundry.toml`) was hit
   for real in this milestone, not just theorized.** The new fork test file used raw
   `block.timestamp` in several places instead of the `vm.getBlockTimestamp()` pattern every
   other test file in this repo already follows. One occurrence — `mintTimestamp =
   block.timestamp`, captured *before* `mint()` and *before* an intervening `vm.warp` — got
   compiler-deduplicated with a later `block.timestamp` read inside `_actionCtx` (called
   *after* the warp), so the variable silently held the **post-warp** value instead of the
   captured pre-mint one. The symptom was a `TermsMismatch()` revert in `settleToLp`: the
   reconstructed `Economics.expiry` was off by exactly the warp's duration (7,200s), because
   it no longer matched the `expiry` `PositionManager` actually derived at mint (both
   participate in `TermsLib.termsSalt`, so any drift fails address re-derivation). Fixed by
   routing every timestamp read in `test/fork/BaseFork.t.sol` through `vm.getBlockTimestamp()`,
   consistent with the rest of the suite. This is the exact failure mode the `foundry.toml`
   comment already warns about — useful confirmation that the rule is load-bearing, not
   theoretical.

**Not done this pass (still open, tracked separately from the fork-test deliverable above):**
determining which candidate chains expose a trustworthy L1 block hash (Q9's mode-B
availability residue), and replacing Milestone 0′'s modeled Arbitrum L1 data-fee figure with a
live-queried one. Both require independently verifying a *different* chain's infrastructure
(Arbitrum Orbit's L1-pricing precompiles; candidate chains' block-hash exposure) rather than
Base's — genuinely separate research, not addressed in this Base-only pass.

### Milestone 6 — Adversarial — **COMPLETE**

Invariant and fuzz campaigns, per this section's original list:

- **Token conservation** (generalizes "no account holds more than
  `recordedCollateral + recordedSettlement`"): the sum of collateral/settlement balances
  across every known holder — LP, taker, fee vault, venue, and every minted
  `PositionAccount` — always equals the tokens' own `totalSupply()`. Nothing is ever
  created, destroyed, or permanently misplaced by any sequence of real actions, which
  subsumes "no action moves position assets outside `{lp, ownerOf(positionId), feeVault,
  venue}`" — there is nowhere else for value to have gone if the sum still balances.
- A venue returning less than `minAmountOut` always reverts — enforced structurally by
  `ISettlementVenue.swap`'s own contract (real adapter and mock alike); not independently
  re-tested here since Milestone 5's fork tests already exercise it against the real router.
- **I4** (taker-directed outflow always nets exactly `feeBps`, rounded up, to the vault):
  checked continuously across the whole campaign, not just per-call — a running
  independently-computed ghost total is compared against the fee vault's live balance after
  every successful `settleToTaker`/`mutualUnwind`.
- **I3** (no reachable state in which neither `MutualUnwind` nor `SettleToLp` can succeed
  after expiry): the single most important check in the suite, since violating it means
  permanently stranded funds with no admin to call and, in v3, no repoint either. Verified by
  actually *performing* the real `settleToLp` call on every expired, unsettled position after
  every sequence — not just trusting code inspection — via an EVM state
  snapshot/revert (`vm.snapshotState`/`vm.revertToState`) so the liveness probe itself never
  perturbs the ongoing campaign.
- **I2** (no reachable state in which any term differs from the salt preimage): checked by
  construction, exactly as anticipated — re-deriving every minted position's account address
  from its recorded `Economics`/`Pointers` always yields the stored account.

**Delivered:** `test/invariant/handlers/PositionHandler.sol` (the fuzzer's target contract:
mint/settleToTaker/settleToLp/mutualUnwind/warp actions against the real
manager/account/authz/arbiter/condition stack, two conditions deep — see finding below) and
`test/invariant/PositionInvariants.t.sol` (the four standing invariants above). 256 runs ×
50 depth (12,800 calls per invariant) at the committed `[invariant]` profile in
`foundry.toml`; additionally confirmed clean at a different fuzz seed and at a 4×-heavier
1000×100 (100,000 calls per invariant) stress pass — 0 reverts, 0 discards throughout.

**Real gap this milestone's work found and closed, in the test harness, not the contracts:**

1. **A single position's `Pointers.condition` is immutable for its whole life (§3.1-§3.3),
   and `TakerProfitCondition`/`ExpiryCondition` are mutually exclusive gates, not
   composable ones.** The handler's first draft wired every minted position to
   `TakerProfitCondition` and then fuzzed the arbiter-gated path for *both*
   `SettleToTaker` and `SettleToLp` against it. `TakerProfitCondition.check` unconditionally
   returns `false` once `block.timestamp >= economics.expiry` (correctly — it exists only to
   gate pre-expiry taker settlement), so any arbiter-gated `SettleToLp` attempt against such
   a position can never succeed: `ConditionArbiter` always returns `BadApproval` for that
   slot. Surfaced immediately (within the first handful of runs) as `BadApproval(2)` on a
   3-call shrunk sequence. Fixed by giving the handler two separately-signed profiles — one
   wired to each condition — with `mint` fuzzing which one a new position uses, and each
   downstream action gating its own arbiter-path attempt on the position's actual wired
   condition (falling back to the direct LP+taker path otherwise). Confirms a real
   constraint worth stating plainly for anyone designing a new `ICondition`: **one position
   commits to exactly one arbiter-slot condition for its entire life** — an LP wanting both
   automated pre-expiry taker settlement and automated post-expiry recovery on the same
   position needs a condition that itself checks both cases (or accept that the direct
   LP+taker 2-of-2 path, which needs no condition at all, covers the other side), not two
   conditions layered on one `Pointers` commitment.

**Not attempted this pass:** a formal Certora/Halmos specification (not called for by this
section's own list, which specifies Foundry invariant/fuzz campaigns) and multi-chain fuzzing
(the handler exercises one chain's worth of local mock infrastructure per Milestone 6's own
scope; Milestone 5 already covers real cross-adapter correctness on live Base state).

### Milestone 7 — LP Router (new, Q7's resolution, §3.9) — **COMPLETE**

A periphery contract enabling multi-LP-backed positions without any change to the 3-slot
signer model. Scope:

- **Core fix (required, not peripheral):** `PositionManager._verifySignature` gains the
  same ECDSA-or-ERC-1271 branch `AuthzModule._verify` already has — a `LiquidityProfile`
  signed by a contract (`profile.lp.code.length > 0`) is currently unverifiable at all.
- **`src/periphery/LPRouter.sol`:** `matchAndMint` — pulls each backer's allocated
  collateral (≤ 8, a gas-bounded cap), assembles and self-approves one synthetic
  `LiquidityProfile`, calls `PositionManager.mint`, and distributes the received premium to
  each backer per their own quoted rate. Per-`positionId` storage of each backer's
  contributed-collateral fraction, for later settlement-proceeds distribution.
- **`isValidSignature`:** approves (a) exactly the profile hashes it itself constructed and
  recorded, and (b) `SettleToLp` action digests for its own known positions unconditionally
  (re-deriving the account address from the claimed terms first) — the I3 backstop that
  makes post-expiry recovery available regardless of which single `condition` the position
  was minted with, per §3.9's reasoning. Nothing else.
- **App-facing reads, added during post-implementation review:** `backerAllocationsOf`
  (parallel-array getter) and the `BackerContributed` event — found missing when checking
  §8's account-inspector requirement against the actual ABI; without them, an app had no way
  to learn a router-backed position's backer breakdown at all.
- **Signed `BackerQuote`s, found and fixed while building the companion app's multi-LP UI
  (DECISIONS.md Q7 addendum, High severity):** the first `matchAndMint` took
  `BackerAllocation{backer, units, pricePerUnitPerHour}` as bare, unsigned calldata — the
  only real check was the backer's standing ERC-20 allowance, which bounds collateral
  pulled but nothing about the *rate* the caller claims for it. Given backers are meant to
  grant one broad, reusable allowance rather than a per-match approval, this let anyone
  permissionlessly and repeatedly capture a backer's yield toward zero using only that
  backer's own already-granted allowance. Fixed by requiring each `BackerAllocation` to
  carry an EIP-712-signed `BackerQuote` — the router-backed analogue of `LiquidityProfile`,
  mirroring nearly every field (rate, capacity via `maxUnits`/`consumedUnitsForQuote`,
  duration bounds, option-type support, full module wiring) so a caller can only choose
  *which* signed quotes to use and how many units of each, never the terms. Quote hashing
  moved into a new `BackerQuoteLib` (mirrors `DigestLib`/`TermsLib`'s existing pattern:
  shared library for any hash that must be reproduced outside the verifying contract, as
  opposed to `_hashProfile`, which only the router itself ever needs).
- **Explicitly out of v1 scope:** `MutualUnwind`, `SweepDust`, `RawExecute` for
  router-backed positions; any change to `AuthzModule`, `ConditionArbiter`, or any
  `ICondition`. (Milestone 7's original claim here also included "any change to
  `PositionAccount`" — narrowed by Milestone 8 below, which added one: a generic,
  router-agnostic settlement-notification hook, not router-specific logic.)

**Delivered (at Milestone 7 completion):** `src/interfaces/ILPRouter.sol`,
`src/periphery/LPRouter.sol`, `src/libraries/BackerQuoteLib.sol`, `test/unit/LPRouter.t.sol`
(17 tests, including 7 regression tests for the signed-quote fix — one reproduces the exact
exploit and confirms it now reverts) plus `test/unit/PositionManagerContractSigner.t.sol` (2
tests, the core fix in isolation). 129/129 tests passing project-wide at the time — see
Milestone 8 for the current count.

### Milestone 8 — Post-review hardening (new, not in this document's original plan) — **COMPLETE**

Not part of the Milestone 0–7 build plan: a security-review pass over the completed v3
stack (core + `LPRouter`), including a static-analysis pass (Slither, installed and run —
the rest of its 39 raw findings are false positives or already-documented, accepted
tradeoffs against this design: pre-approved-allowance `transferFrom` pulls, the intentional
`RAW_EXECUTE` default-deny escape hatch, bounded per-match loops, Solidity's own
zero-initialization of locals/mappings). Two real findings, both detailed in their own
sections above and cross-referenced from there rather than restated in full here:

1. **[HIGH] §3.9 — `LPRouter` backer-crediting silently skipped when a router-backed
   position was settled by calling `PositionAccount` directly**, bypassing
   `settleAndCredit`'s balance-delta measurement — the only place crediting used to happen.
   Fixed by `ILPSettlementHook`, a push-based notification the account calls on
   `economics.lp` after every settlement payout, regardless of caller. PoC-confirmed
   (`test/unit/LPRouterStrandingPoC.t.sol`), now a passing regression test with exact
   pro-rata credited amounts asserted.
2. **[MEDIUM] §3.4 — settlement-time swaps had no oracle-derived `minAmountOut` floor**,
   unlike the mint-time PUT creation swap; a taker-controlled floor on the PUT
   LP-remainder swap-back could let a taker sandwich the LP's own swap on a thin venue.
   Fixed by having `PositionAccount` derive the same oracle floor at settlement, with any
   caller-supplied value only able to tighten it.

Also fixed, none rising to a documented design-level finding (implementation-level
corrections, not decisions this register tracks): a wrong custom error on the
mint-time slippage-cap check (`PositionManager.sol`, now `SlippageTooHigh`); `_queryDecimals`
now does the staticcall-plus-explicit-revert §3.3 always specified, rather than an
undecorated interface call; two redundant same-transaction oracle reads removed (`mint` and
`settleToTaker` each read `oracle.price()` twice for the same value); a Chainlink adapter
round-completeness check (`answeredInRound >= roundId`) added as defense-in-depth; zero-address
constructor guards added to `PositionAccount`, `PositionManager`, `LPRouter`, and
`ChainlinkPriceOracleAdapter`; `PositionAccount` now formally declares
`is IPositionAccountMintHooks` (the interface itself moved out of `PositionManager.sol` into
its own file, `src/interfaces/IPositionAccountMintHooks.sol`, so the account can depend on it
without depending on the manager's file).

**Delivered:** `src/interfaces/ILPSettlementHook.sol` (new),
`src/interfaces/IPositionAccountMintHooks.sol` (new, relocated), plus the fixes above in
`src/PositionAccount.sol`, `src/periphery/LPRouter.sol`, `src/interfaces/ILPRouter.sol`,
`src/PositionManager.sol`, `src/adapters/ChainlinkPriceOracleAdapter.sol`, and
`src/interfaces/IPriceOracle.sol` (a shadowed named return, cosmetic). **147/147 tests
passing** across 16 suites (`test/unit/`, `test/fork/`, `test/invariant/`, `test/gas/`) —
the four standing invariants (Milestone 6) re-run clean afterward at the same 256×50 depth,
0 reverts, confirming the fixes didn't disturb token conservation, I3, I4, or I2.

**Re-measured against `GAS.md`'s exact baseline** (`test/gas/GasGate.t.sol`, same four
actions, solo-LP/EOA `lp`) rather than reasoned about — its "worst action" check covers
`settleToTaker`/`settleToLp`/`mutualUnwind`, not only `mint` (it's `settleToTaker` that sets
Arbitrum's margin, the tightest of the three chain/action pairings at ~4.9×), so this was
worth actually checking, not assuming. Every action came back flat-to-improved, none worse:

| Action | `GAS.md` baseline | Re-measured | Delta |
|---|---:|---:|---:|
| `mint` (CALL) | 240,406 | 240,402 | −4 |
| `settleToTaker` | 181,228 | 181,042 | **−186** |
| `settleToLp` (healthy oracle) | 67,838 | 67,653 | −185 |
| `mutualUnwind` | 114,004 | 113,896 | −108 |

`settleToTaker`'s improvement is directly attributable: the redundant same-transaction oracle
read removed there costs more than the new `_oracleFloor` computation (pure, no external
call) adds. `settleToLp`/`mutualUnwind` were expected to get *slightly more expensive*, not
less — each gained one `EXTCODESIZE` check (`_notifyLp`'s `lp.code.length` test, itself
otherwise a no-op for an EOA `lp`) — so their improvement is most likely dispatcher/bytecode-
layout noise from the new errors/functions elsewhere in the same contract shifting selector
lookup costs, not a claim this document makes with the same confidence as `settleToTaker`'s.
Either way, nothing regressed, so all three chains' verdicts in `GAS.md`'s own table stand.
**Still not measured:** a *router-backed* settlement's `onPositionSettled` call — `GAS.md`'s
benchmarks are solo-LP/EOA-`lp` figures throughout and don't exercise a contract `lp` at all,
so that specific cost is genuinely unmeasured here, not merely assumed flat. Also noticed,
or a bug I introduced: `mint`'s calldata is measured at 1,220 bytes here vs. `GAS.md`'s
recorded 1,124 — every other action's calldata byte count matches its `GAS.md` figure
exactly. `PositionManager.mint`'s external signature and the `LiquidityProfile`/`Pointers`
shapes are unchanged this session, so this 96-byte (exactly 3 words) gap predates this
milestone's work; flagged here rather than silently left, since it's a real, currently-
unexplained mismatch between this file and the measured test fixture, not something this
pass's changes could have caused or should paper over.
