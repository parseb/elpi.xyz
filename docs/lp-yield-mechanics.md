# LP Idle Yield Mechanics & Risk Disclosure

**Protocol:** elpi (https://elpi.xyz)  
**Component:** `V4LiquidityVault.sol` (Milestone UV3)  
**Revision:** September 2026

---

## 1. Overview & Motivation

In traditional decentralized option protocols, an Liquidity Provider's (LP) capital sits idle as unutilized ERC-20 tokens:
- **Uncommitted:** Earning 0% in an LP wallet or unallocated router buffer.
- **Committed:** Earning 0% inside a `PositionAccount` while the option agreement is live.

Because options on **elpi** typically run for hours to days, capital inefficiency is a substantial cost for liquidity providers.

`V4LiquidityVault` solves this by staging uncommitted LP collateral in **Uniswap v4 AMM pools**, earning trading fees between option agreements without violating protocol safety invariants.

---

## 2. Invariant Safety Guarantees

Every step in the staging flow is designed to preserve elpi's four core invariants:

```
Phase 1 — Uncommitted: LP Wallet → V4LiquidityVault (earns AMM fee yield in v4)
Phase 2 — Committed:   V4LiquidityVault → PositionAccount (pure ERC-20, I1 & I3 safe)
Phase 3 — Post-Settle: PositionAccount → LP (via ILPSettlementHook.onPositionSettled)
                       → V4LiquidityVault (re-staked automatically)
```

| Invariant | Guarantee | Mechanism |
|---|---|---|
| **I1 (Single-position insolvency bound)** | Shared pool failure cannot drain active option positions. | Collateral inside `PositionAccount` is strictly raw ERC-20. The vault operates entirely outside the account boundary. |
| **I3 (Venue-free expiry settlement)** | Post-expiry settlement (`settleToLp`) never depends on Uniswap v4. | Collateral is extracted to pure ERC-20 prior to minting. If Uniswap v4 is frozen or paused, the position still settles cleanly. |
| **Gas Isolation** | Re-staking failure never prevents settlement. | `PositionAccount._notifyLp` calls `onPositionSettled` within a `try/catch` bounded to `LP_HOOK_GAS = 300,000`. |

---

## 3. Liquidity Staging & Impermanent Loss (IL)

### The IL Challenge
When collateral (e.g., WETH) is placed in a two-sided Uniswap v4 pool against USDC, price movement can cause the LP's position to rebalance into USDC, exposing the LP to impermanent loss and reducing the available WETH collateral needed for option minting.

### Recommended Configuration: Out-of-Range Staging
To eliminate impermanent loss while staging collateral:
1. **Single-Sided Liquidity:** Configure the vault's `tickLower` and `tickUpper` such that the range is entirely single-sided (e.g., above current spot for WETH, or below spot for USDC).
2. **Fee Generation:** Staging earns fees whenever price swings through the configured range.
3. **Deterministic Capital:** When extracted for minting (`extractForMint`), 100% of the collateral is returned in the native asset without token conversion.

---

## 4. Extraction & Settlement Lifecycle

### 4.1 Extraction for Minting (`extractForMint`)
1. An LP signs a `BackerQuote` committing collateral from `address(vault)`.
2. The LP application triggers `vault.extractForMint(asset, amount)`.
3. The vault calls `poolManager.modifyLiquidity` with negative delta, receives raw ERC-20 tokens, and approves `LPRouter`.
4. `LPRouter.matchAndMint` executes, pulling pure ERC-20 tokens into the newly derived `PositionAccount`.

### 4.2 Auto Re-Staking (`onPositionSettled`)
When any settlement path completes (`settleToTaker`, `settleToLp`, or `mutualUnwind`):
1. `PositionAccount._notifyLp` calls `ILPSettlementHook(vault).onPositionSettled(positionId, asset, amount)`.
2. `V4LiquidityVault` attempts to re-deposit the proceeds into the configured Uniswap v4 pool via `_addLiquidity`.
3. If the re-stake succeeds, the capital immediately begins earning AMM fees again.
4. If re-staking fails (e.g. pool pause or temporary gas constraint), proceeds remain in `pendingAsset[asset]`.

### 4.3 Manual Recovery (`manualRestake`)
If automated re-staking is interrupted, funds are never lost:
- The vault owner can call `vault.manualRestake(asset)` at any time to re-invest accumulated `pendingAsset`.
- Alternatively, the owner can call `vault.withdraw(asset, amount)` to pull funds directly to their wallet.

---

## 5. Security & Risk Register

1. **Vault Bug Blast Radius:** A vulnerability in `V4LiquidityVault` affects only the specific LP using that vault. Other LPs and active `PositionAccount` agreements are completely unaffected (I1 isolation).
2. **Rebasing / Fee-on-Transfer Tokens:** Rebasing or fee-on-transfer tokens must never be staged in `V4LiquidityVault` (enforced via ModuleRegistry curation).
3. **Execution Window:** The 2-transaction sequence between extraction and minting should be executed tightly to ensure the extracted collateral is promptly committed.
