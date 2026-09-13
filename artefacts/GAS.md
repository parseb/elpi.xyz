# GAS.md — Milestone 0′ gas gate (v3 schema)

Re-run of ARCHITECTURE.md §9.0 against the v3 (fixed-agreement, salt-committed) schema.
Prior run archived at `GAS-v2-ARCHIVED.md`; that run measured a schema that no longer
exists and is not a comparison baseline for pass/fail here.

**Decision rule (ARCHITECTURE.md §9.0, unchanged):** if per-position overhead exceeds 15%
of a representative premium on a given chain, per-position custody does not ship on that
chain.

---

## Pre-registration — fixed BEFORE the benchmark was run

Written and committed before any cost-model contract in `test/gas/` was executed, per the
explicit instruction not to tune the candidate or pick the denominator after seeing the
numerator. If a later section of this file disagrees with what's written here, the later
section is wrong and this section is what was promised in advance.

### Representative premium per chain

| Chain | Representative premium | Basis |
|---|---|---|
| Ethereum mainnet | **$200.00** | Tokenized-asset liquidity is concentrated on L1 (§0, §6) — mainnet users are self-selected for larger size by already paying L1 gas as a cost of entry. Set at 100× the L2 figure below as a defensible order-of-magnitude scaling ("a full-size single-position ticket" vs. "a retail micro-trade"), not a number picked to make or break the 15% line. |
| OP-stack L2 (e.g. Base) | **$2.00** | Reused verbatim from v2's own gate (ARCHITECTURE.md §9.0: "v2's $2.00 figure came from an L2 tokenized-stock scenario") for an apples-to-apples comparison against the prior run's denominator. |
| Arbitrum Orbit chain | **$5.00** | The prior-art protocol (OptionHood, `reference/OPTIONHOOD-v3-SPEC.md`) *is* this chain class — Robinhood Chain, an Arbitrum Orbit L2 built specifically for tokenized-stock retail trading. Set between the generic-L2 figure and mainnet's: a purpose-built tokenized-asset appchain sees larger tickets than a generic L2 dApp, nowhere near mainnet institutional scale. |

### Pricing inputs — live-queried where possible, timestamped

Queried 2026-07-30 ~15:50-15:56 UTC via public RPCs (not archival/estimated figures):

| Input | Value | Source |
|---|---|---|
| ETH price | $2,000 (per user's standing 2026 assumption) | Not re-verified live in this pass — volatile, flag before any real economic decision |
| Mainnet base fee | **~4.10 gwei** (4,085,410,945 / 4,106,810,940 wei across two reads, block ~25,646,681) | `cast base-fee --rpc-url https://ethereum-rpc.publicnode.com` and `https://eth.merkle.io` (agreed) |
| Base (OP-stack) L2 execution base fee | **0.005 gwei** (5,000,000 wei, stable across reads) | `cast base-fee --rpc-url https://mainnet.base.org` |
| Base L1-data-fee oracle | Live `GasPriceOracle` predeploy, address `0x420000000000000000000000000000000000000F`, verified by call (not assumed) — `isEcotone()==true`, `isFjord()==true`, `l1BaseFee()` = 3,926,384,191 wei (~3.93 gwei, consistent with the direct mainnet read above), `baseFeeScalar` = 2269, `blobBaseFeeScalar` = 1,055,762 | `cast call` against `https://mainnet.base.org`; see methodology note below |
| Arbitrum One execution base fee | **~0.020 gwei** (20,002,000-20,304,000 wei across two reads) — used as the Orbit-chain proxy (Robinhood Chain itself is an Orbit L2; a public Orbit testnet/mainnet RPC was not queried, so Arbitrum One's own reading stands in for "an Arbitrum Orbit chain" per the task's chain-class framing, flagged explicitly as a proxy, not the exact target chain) | `cast base-fee --rpc-url https://arb1.arbitrum.io/rpc` |
| Arbitrum L1 calldata pricing | **Not live-queried** — this pass does not call Arbitrum's L1-pricing precompiles (`ArbGasInfo`/`NodeInterface`), because their exact addresses were not independently verified this session and the project rule is never to hardcode an unverified address, even for a read-only call. Modeled instead (see Results, flagged as MODELED not MEASURED) | — |

**Methodology note on the Base L1 data fee, worth stating up front so the Results section
isn't the first place it's noticed:** `GasPriceOracle.getL1Fee(bytes)` was probed with two
small test payloads (20 bytes, 200 zero bytes) before any real calldata existed, and
returned the *identical* fee (42,161,772,185 wei ≈ $0.084 at the inputs above) for both —
consistent with Fjord's minimum-charge floor dominating at small sizes. **The real,
action-sized calldata built in this gate is large enough that this floor may not bind for
every action** — re-queried per action against real calldata bytes in the Results section,
not assumed to be the floor throughout.

### What is measured vs. modeled — stated up front

- **Execution gas** (mainnet, Base L2, Arbitrum L2): measured directly via `forge` against
  the real, deployed ERC-6551 Registry bytecode (`lib/erc6551-reference`) and the labelled
  cost-model contracts in `test/gas/`. Same EVM ruleset (Cancun) everywhere per
  `foundry.toml`, so this component is chain-agnostic by construction — what differs per
  chain is the *price* of that gas and the *L1 data fee* layered on top for L2s, not the
  opcode-level cost itself.
- **Mainnet dollar cost:** measured execution gas × the live base fee above × ETH price.
  No L1 data fee component — mainnet calldata is not posted anywhere else.
- **OP-stack L2 dollar cost:** measured execution gas × the live Base L2 base fee, **plus**
  a real `getL1Fee(bytes)` call against the live oracle using the *exact* ABI-encoded
  calldata for that action (not an estimate).
- **Arbitrum Orbit dollar cost:** measured execution gas × the live Arbitrum base fee,
  **plus** a MODELED (not live-queried, see above) L1 calldata cost using a documented,
  labelled formula, clearly distinguished from the OP-stack figure's live-oracle grounding.

---

## Results

> **Post-hoc note (Milestone 4):** `IPositionManager.mint` gained a `uint8 optionType`
> parameter after this gate ran (a real interface gap — the original signature had no way
> for a taker to choose CALL/PUT under a `supportsOptionType == BOTH` profile). The `mint`
> calldata-bytes figure and its Base L1 fee below are therefore ~32 bytes (one padded
> calldata word) short of the current interface. Not re-measured: at these margins
> (mint passes the 15% gate by ~10.6x on mainnet, ~79x on the OP-stack L2), 32 bytes of
> calldata cannot plausibly change any verdict, and re-running the full pre-registered gate
> for an immaterial delta would cost more than it's worth. Flagged here rather than quietly
> left stale.

All numbers below came from `forge test --match-contract GasGateTest -vv`
(`test/gas/GasGate.t.sol`) on the first run that executed successfully end to end. Three
bugs blocked that run and were fixed before any number was recorded — logged here because
"fixed until it passed" and "tuned until it passed" must stay distinguishable:

1. `TermsLib.deriveAccount` calls the real canonical registry address; a freshly-deployed
   test registry doesn't live there. Fixed by `vm.etch`-ing the real registry's own runtime
   code onto the canonical address, so both the harness and `TermsLib` resolve to identical
   real code. Changes nothing about what's measured.
2. `MockTakerProfitCondition`'s payout recompute mixed a 1e18 fixed-point price delta with
   raw settlement-asset units without rescaling by `10**settlementDecimals` — a real decimal
   bug, caught only by running the test against a 6-decimal settlement asset, not by
   inspection. Fixed by rescaling properly (see `MockConditions.sol`).
3. The test pre-approved the venue for `type(uint256).max` on the account's behalf *and*
   the account's own `settleToTaker` separately calls `safeIncreaseAllowance` — additive on
   top of an already-max allowance, which overflows. Fixed by removing the redundant
   test-side approval; the account approves what it needs itself.

None of the three changed how much a real action computes, stores, or calls — they made an
already-specified scenario executable. No gas-relevant logic was removed or added to move a
number across the 15% line.

### Raw execution gas (chain-agnostic; same Cancun ruleset everywhere)

| Action | Gas | Calldata (bytes) |
|---|---:|---:|
| `mint` (CALL) | **240,406** | 1,124 |
| `mint` (PUT) — CALL total + creation-swap component below | **344,660** | 1,124 (same shape) |
| — creation-swap component only | 104,254 | — |
| `settleToTaker` (LP direct + arbiter/`TakerProfitCondition`) | **181,228** | 2,724 |
| `settleToLp` (taker direct + arbiter/`ExpiryCondition`), healthy oracle | **67,838** | 2,468 |
| `settleToLp`, **reverting oracle** | **67,838** | 2,468 |
| `mutualUnwind` (LP + taker direct, no arbiter) | **114,004** | 1,540 |

**`settleToLp` costs *exactly* the same gas whether the oracle works or reverts outright.**
Not "should" — measured, both runs, identical figure. That is I3 holding under an adversarial
oracle, empirically, not merely asserted by the code's shape.

`settleToTaker`/`settleToLp` above use an **arbiter-inclusive** quorum (one direct ECDSA
signer + the arbiter via `ConditionArbiter`/`ICondition`) rather than two direct human
signers, because the protocol's own stated design goal — "anyone can assemble the arbiter's
approval… zero keeper liveness requirement" (§2.2) — makes this the operationally
representative path, not the cheaper edge case. A direct LP+taker `settleToLp` (no arbiter,
no condition machinery at all) would cost meaningfully less; `mutualUnwind` above shows that
floor directly, since the arbiter is structurally excluded from it by `eligibleSlotMask` and
it is therefore the cheapest settlement path measured.

### Dollar cost per chain

Mainnet and Base figures are **fully measured** (live base fee × real gas; live
`GasPriceOracle.getL1Fee` × real calldata). Arbitrum's execution-gas dollar figure is
measured against a live base fee; its L1 data-fee figure is **MODELED**, not live-queried
(see pre-registration) — an uncompressed EIP-2028 upper bound (4 gas/zero byte, 16
gas/nonzero byte, computed from the exact real calldata, priced at the mainnet L1 base fee).
Real Arbitrum compression would lower this; it is not assumed away.

| Action | Mainnet $ | Base exec $ | Base L1 $ (live) | **Base total $** | Arb exec $ | Arb L1 $ (modeled upper bound) | **Arb total $ (modeled)** |
|---|---:|---:|---:|---:|---:|---:|---:|
| `mint` (CALL) | 1.97133 | 0.002404 | 0.000336 | **0.002740** | 0.009688 | 0.061762 | **0.071451** |
| `mint` (PUT) | 2.82621 | 0.003447 | 0.000336 | **0.003782** | 0.013890 | 0.061762 | **0.075652** |
| `settleToTaker` | 1.48607 | 0.001812 | 0.000584 | **0.002396** | 0.007303 | 0.146419 | **0.153723** |
| `settleToLp` (either oracle state) | 0.55627 | 0.000678 | 0.000537 | **0.001216** | 0.002734 | 0.134382 | **0.137115** |
| `mutualUnwind` | 0.93483 | 0.001140 | 0.000605 | **0.001745** | 0.004594 | 0.087609 | **0.092203** |

### Decision rule (15% of representative premium)

| Chain | Premium | 15% threshold | Worst action ($) | Worst as % of premium | Verdict |
|---|---:|---:|---:|---:|---|
| Mainnet | $200.00 | $30.00 | $2.826 (`mint` PUT) | 1.41% | **PASS**, by ~10.6× margin |
| OP-stack L2 (Base) | $2.00 | $0.300 | $0.00378 (`mint` PUT) | 0.19% | **PASS**, by ~79× margin |
| Arbitrum Orbit (modeled) | $5.00 | $0.750 | $0.1537 (`settleToTaker`) | 3.07% | **PASS**, by ~4.9× margin, even under the deliberately conservative uncompressed L1 model |

**All three chains pass, by wide margins, on the actual numbers obtained.** No candidate
parameter was adjusted after seeing this — the pre-registration section above was written
and the premiums fixed before `GasGateTest` was ever run.

### Two findings this run surfaced, neither of which was assumed going in

**1. The §1.6 "trade" the architecture worried about does not bite in 2026's fee
environment.** ARCHITECTURE.md §1.6 flags that deleting five cold `SSTORE`s at mint
(~110k gas) while adding ~7 words of calldata per action is "good on L1 and possibly neutral
on an L2 with two actions per position," and asks the gate to check rather than assume it.
Checked: on Base, the most calldata-heavy measured action (`settleToTaker`, 2,724 bytes)
costs **$0.000584** in L1 data fee — three hundredths of a cent. The concern was real when
written; it does not survive contact with 2026's blob-driven L1 data pricing (Fusaka's 2×
gas-limit and continued blob-throughput scaling). The mint-side SSTORE savings are a clean
win on every chain measured, with no offsetting calldata cost anywhere near the same order
of magnitude. This is a real update to the architecture's own stated risk, not a restatement
of it — say so in `MASTER_ARCHITECTURE.md` rather than carrying the old caveat forward
unexamined.

**2. Raw calldata byte count does not predict OP-stack L1 cost — compressibility does, and
it isn't monotonic.** `mutualUnwind`'s calldata (1,540 bytes) is **shorter** than
`settleToLp`'s (2,468 bytes), but costs **more** in live-queried L1 fee ($0.000605 vs.
$0.000537). Fjord's FastLZ-based fee model prices estimated *compressed* size, and
`mutualUnwind`'s calldata — two independent real ECDSA signatures, high-entropy `r`/`s`
values — compresses worse than `settleToLp`'s, which carries a full nested `ActionContext`
inside the arbiter's approval padded with a lot of repeated/zero-valued struct fields. A
naive "count the bytes" model would have gotten the *ranking* wrong, not just the magnitude
— exactly the kind of thing a live-oracle query catches and a formula-only estimate wouldn't.

### Simplifications this cost model carries — read before treating any number as final

- `settleToTaker` performs one representative venue swap of the account's *full* recorded
  balance, not a profit-only portion split from an unswapped LP remainder (the real CALL/PUT
  branches OptionHood's preserved mechanics require — DECISIONS.md's P&L table). Real
  Milestone 3 code will do less work in the common case (a smaller swap) or more (CALL's
  extra direct-remainder transfer) depending on branch; this number is a reasonable
  single-swap proxy, not a promise of the exact final figure.
- `ConditionArbiter`'s cost model omits step 1 of §2.2 (recomputing the digest from `ctx`
  and comparing to the caller-supplied `digest`) — a real implementation is strictly more
  expensive than what's measured here by roughly one more `keccak256` over the same fields
  `_digest` already hashes. Small relative to the totals above; not zero.
- A minimal-proxy account cannot cache its EIP-712 domain separator as an implementation
  `immutable` (verifying contract differs per clone) — every digest here pays that hash
  fresh. This cost model does *not* optimize that away; a real implementation shouldn't
  either, without a specific reason to believe it's safe to.
- Interface fixes made while wiring this harness, not before (both already applied in
  `src/`): `IAuthzModule.signerSlots` needed the full `ActionContext`, not just `account` —
  it has nothing else to resolve slots from under the v3 schema; and every `IPositionAccount`
  action takes `ctx` alone rather than `ctx` plus a redundant, separately-encoded params
  struct. Both were real gaps in the interfaces as first drafted, not stylistic cleanups —
  see each file's NatSpec for the reasoning.
