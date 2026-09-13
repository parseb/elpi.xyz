# OptionCore Properties Specification

The following invariant and property specifications define the correctness and security guarantees for the OptionCore protocol suite.

### Global Invariants

- [x] **GL-01**: **Token Conservation** — Total supply of collateral and settlement assets is conserved across all protocol participants (LP, Taker, Fee Vault, Venue, PositionAccounts). (Guarantee: `SHOULD-HOLD`)
- [x] **GL-02**: **Fee Vault Accounting** — The fee vault balance precisely matches the cumulative ceiling-rounded fee computed across all successful settlements and mutual unwinds. (Guarantee: `SHOULD-HOLD`)
- [x] **GL-03**: **Terms Address Re-derivation (I2)** — Every position's committed `Economics` and `Pointers` re-derive its exact ERC-6551 account address via `TermsLib.deriveAccount`. (Guarantee: `SHOULD-HOLD`)
- [x] **GL-04**: **Post-Expiry Settleability (I3)** — Expired unsettled positions (`block.timestamp >= expiry`) are always settleable to the LP. (Guarantee: `SHOULD-HOLD`)
- [x] **GL-05**: **Account State Monotonicity** — `accountState` on every `PositionAccount` strictly increases monotonically on state transitions. (Guarantee: `SHOULD-HOLD`)

### Specific Invariants

- [x] **SP-01**: **LP Capacity Non-Exceedance** — `consumedUnits[profileHash] <= totalUnitsOf[profileHash]` at all times. (Guarantee: `SHOULD-HOLD`)
- [x] **SP-02**: **Write-Once Realized State** — `PositionAccount.realized` can only be written once during mint initialization. (Guarantee: `SHOULD-HOLD`)
- [x] **SP-03**: **Taker Profit Verification** — `settleToTaker` enforces strict positive PnL and price freshness. (Guarantee: `SHOULD-HOLD`)
- [x] **SP-04**: **Position Asset Dust Sweep Rejection** — `sweepDust` rejects sweeping collateral or settlement tokens. (Guarantee: `SHOULD-HOLD`)
- [x] **SP-05**: **Raw Execute Timelock Delay** — `rawExecute` enforces a 48-hour timelock between proposal and execution. (Guarantee: `SHOULD-HOLD`)
