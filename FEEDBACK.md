# Uniswap v4 Developer Feedback — elpi (alpha.elpi.xyz)

**Protocol:** [elpi (https://alpha.elpi.xyz)](https://alpha.elpi.xyz)  
**Repository:** [https://github.com/parseb/elpi.xyz](https://github.com/parseb/elpi.xyz)  
**Form Submission:** For submission to the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback)  

---















<br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br>
---

## AI summary of integration challanges

## 1. Executive Summary

During the development of **elpi**'s Uniswap v4 integration, we implemented:
1. **`UniswapV4VenueAdapter`**: A settlement venue executing options settlement swaps via Uniswap v4 flash accounting (`unlock`, `swap`, `sync`, `settle`, `take`) with zero persistent balance.
2. **`V4LiquidityVault`**: An LP capital vault staging idle collateral in Uniswap v4 concentrated liquidity pools between option agreements, atomically extracting raw ERC-20 at mint (`extractForMint`) and auto-restaking upon settlement (`onPositionSettled`).
3. **`V4LPRouterRestaker`**: An atomic multi-backer router restaker enabling single-transaction settlement and re-staking.

Overall, Uniswap v4's flash accounting and singleton `PoolManager` architecture provided significant gas savings and architectural simplicity compared to v3 pool deployments. Below is detailed feedback on our experience.

---

## 2. What Worked Exceptionally Well

- **Flash Accounting (`unlock` / `unlockCallback`)**:
  - The separation of state transitions from token transfers is a major leap forward. In `UniswapV4VenueAdapter`, we deliver tokens directly to the `PositionAccount` via `poolManager.take()`, completely eliminating intermediate token hops and maintaining zero token custody (strictly enforcing Invariant I1).
- **Singleton Architecture & Gas Efficiency**:
  - Having all pools managed in a single `PoolManager` drastically simplified multi-pool routing and reduced deployment overhead compared to v3 factory/pool deployments.
- **Transient Storage & Cancun Support**:
  - Native support for EIP-1153 (`tstore`/`tload`) in Foundry Cancun EVM mode makes state locks and transient accounting extremely efficient.
- **Extensible Hook Architecture**:
  - The hook flags bitmap design offers predictable execution points throughout the swap and liquidity lifecycle.

---

## 3. Areas for Improvement & Pain Points

### A. Flash Accounting Delta Debugging
- **Challenge**: When an `unlockCallback` fails because balances do not settle cleanly, the contract reverts with `CurrencyNotSettled()`.
- **Feedback**: It is often difficult to deduce *which* currency failed to settle and by *how much* (especially during complex multi-action callbacks or fuzzing). Having error parameters (e.g. `CurrencyNotSettled(Currency currency, int256 outstandingDelta)`) would save significant developer hours.

### B. Sign Conventions Between Swaps and Liquidity
- **Challenge**: 
  - In `poolManager.swap()`, negative `amountSpecified` denotes exact input, and positive `delta` indicates tokens owed to the caller.
  - In `poolManager.modifyLiquidity()`, negative `liquidityDelta` denotes removing liquidity, requiring callers to interpret `amount0` and `amount1` deltas carefully with `take` and `settle`.
- **Feedback**: Standardized helper libraries or explicit wrapper functions in `@uniswap/v4-periphery` (e.g. `LiquiditySettler` or higher-level vault helpers) would make vault integrations much smoother.

### C. Hook Address Salt Mining in Foundry
- **Challenge**: Mining CREATE2 salts to match specific hook address flag bits requires custom deployment scripts that can be slow during rapid local test iterations.
- **Feedback**: First-party Foundry cheatcode plugins or optimized pre-built mining binaries in the Uniswap v4 devkit would streamline developer workflows.

---

## 4. Conclusion

Uniswap v4 provides the ideal foundation for structured financial products like **elpi**. The flash-accounting primitive allowed us to create non-custodial options settlement and idle liquidity staging that uphold mathematical safety invariants with minimal gas overhead.
