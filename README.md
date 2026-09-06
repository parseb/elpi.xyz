# elpi (elpi.xyz) — Uniswap v4 Integration (`OH_UNISWAP`)

**elpi (https://elpi.xyz)** is a decentralized options protocol built on fixed agreements over disclosed risks. Every term — including oracle and settlement execution venue — is fixed at mint by address derivation and is unchangeable thereafter.

This repository implements the Uniswap v4 integration for **elpi**, providing:
1. **Execution Venue (`UniswapV4VenueAdapter`)**: Single-hop Uniswap v4 execution venue implementing `ISettlementVenue` with flash accounting (`unlock`, `sync`, `settle`, `take`).
2. **Settlement Fee Waiver & Netting (`OptionSettlementHook`)**: A Uniswap v4 hook on `DYNAMIC_FEE_FLAG` pools waiving AMM fees (`overrideFee = 0`) on option settlement swaps (protecting Invariant I4) and executing EIP-1153 transient internal flow netting.
3. **Idle Capital Staging (`V4LiquidityVault`)**: LP capital vault staging collateral in Uniswap v4 to earn AMM fees while uncommitted, safely extracting raw ERC-20 at mint and re-staking post-settlement within the `LP_HOOK_GAS` (300,000) boundary.

---

## Core Invariants

The integration strictly upholds the 4 core invariants of elpi:

| Invariant | Description | Enforcement |
|---|---|---|
| **I1** | Collateral is bound 1:1 to a position; insolvency is strictly bounded. | Flash accounting in `UniswapV4VenueAdapter` guarantees zero persistent balances. Vaults operate outside `PositionAccount`. |
| **I2** | Position terms and venues are immutable post-mint. | `routeId = keccak256(abi.encode(PoolKey))` committed into CREATE2 terms salt. Registry is append-only. |
| **I3** | Expiry settlement (`settleToLp`) is oracle-free and venue-free. | Vault and adapter failures cannot prevent expiry recovery. Vault re-staking failure is caught and isolated. |
| **I4** | Protocol fee (`feeBps`) is withheld solely from profitable payouts. | `OptionSettlementHook` waives AMM swap fees (`overrideFee = 0`) on settlement swaps. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    UNISWAP v4 ECOSYSTEM                     │
│                                                             │
│   PoolManager (flash acct) <───────> OptionSettlementHook   │
└──────────────▲─────────────────────────────────▲────────────┘
               │                                 │
┌──────────────┼─────────────────────────────────┼────────────┐
│              │       elpi (elpi.xyz) PERIPHERY │            │
│              │                                 │            │
│   UniswapV4VenueAdapter                        │            │
│   (implements ISettlementVenue)                │            │
│              │                                 │            │
│              │                      V4LiquidityVault        │
│              │                      (stages idle LP capital)│
└──────────────┼─────────────────────────────────▲────────────┘
               │                                 │
┌──────────────┼─────────────────────────────────┼────────────┐
│              │       elpi (elpi.xyz) CORE      │            │
│              │                                 │            │
│       PositionAccount                      LPRouter         │
│   (calls venue.swap(...))             (matchAndMint / LP)   │
└─────────────────────────────────────────────────────────────┘
```

---

## Smart Contracts

- `src/adapters/UniswapV4VenueAdapter.sol`: `ISettlementVenue` adapter for Uniswap v4 flash accounting.
- `src/hooks/OptionSettlementHook.sol`: Uniswap v4 hook for 0-fee settlement swaps, ERC-6551 sender verification, and EIP-1153 flow netting.
- `src/periphery/V4LiquidityVault.sol`: LP idle collateral staging in Uniswap v4 pools, implementing `ILPSettlementHook` and `IERC1271`.
- `script/MineHookSalt.s.sol`: Hook address mining utility for v4 hook flags bitmap (`0xC8`).

---

## Development & Testing

### Prerequisites
- [Foundry](https://book.getfoundry.sh/)

### Build
```bash
forge build
```

### Test
```bash
forge test
```

### Gas Snapshot & Formatting
```bash
forge snapshot
forge fmt
```
