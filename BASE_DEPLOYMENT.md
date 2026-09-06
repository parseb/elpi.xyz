# Base Mainnet Deployment — elpi (elpi.xyz)

This document describes the Base deployment architecture for **elpi (https://elpi.xyz)** with the Uniswap v4 execution venue and LP liquidity staging integration (`OH_UNISWAP`).

---

## 1. Network & Deployment Profile

| Parameter | Value | Notes |
|---|---|---|
| **Network** | Base Mainnet | Chain ID: `8453` |
| **RPC** | `https://mainnet.base.org` | Supported by public and private providers |
| **Protocol Name** | elpi | https://elpi.xyz |
| **EVM Version** | Cancun | Pinned in `foundry.toml` (`tstore`/`tload` enabled) |

---

## 2. Infrastructure Registry

### Existing Core Contracts
| Contract | Purpose | Address / Status |
|---|---|---|
| `PositionManager` | Mint orchestrator & ERC-721 ledger | Core Singleton |
| `ConditionArbiter` | ERC-1271 condition verifier | Core Singleton |
| `LPRouter` | Multi-LP capital coordinator | Periphery Singleton |
| `ChainlinkPriceOracleAdapter` | ETH/USD Price Feed on Base | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |

### Uniswap v4 Integration Components (New)
| Contract | Purpose | Key Parameters |
|---|---|---|
| `UniswapV4VenueAdapter` | `ISettlementVenue` adapter for v4 flash-accounting | `poolManager` (Base v4 deployment) |
| `OptionSettlementHook` | 0-fee settlement hook, ERC-6551 sender verification, EIP-1153 netting | Address mined with prefix `0xC8` (`BEFORE_SWAP`, `AFTER_SWAP`, `BEFORE_SWAP_RETURNS_DELTA`) |
| `V4LiquidityVault` | LP capital vault staging idle collateral in v4 | Out-of-range single-sided configuration |

---

## 3. Deployment Sequence

### Step 1: Deploy UniswapV4VenueAdapter
Deploy the venue adapter pointing to the canonical Base v4 `PoolManager`.
```bash
forge create src/adapters/UniswapV4VenueAdapter.sol:UniswapV4VenueAdapter \
  --constructor-args <POOL_MANAGER_ADDRESS> \
  --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

### Step 2: Mine Hook Address & Deploy OptionSettlementHook
Use `script/MineHookSalt.s.sol` to find a CREATE2 salt producing a hook address with flags `0xC8`:
```bash
forge script script/MineHookSalt.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast \
  --sig "run(address,address,address)" \
  <POOL_MANAGER_ADDRESS> <OWNER_ADDRESS> <ADAPTER_ADDRESS>
```
After deployment, call `hook.addPositionManager(positionManagerAddress)` to authorize elpi option accounts for 0-fee settlement waivers.

### Step 3: Register Canonical Route
Register the v4 pool in `UniswapV4VenueAdapter`:
```solidity
PoolKey memory key = PoolKey({
    currency0: Currency.wrap(WETH),
    currency1: Currency.wrap(USDC),
    fee: 0x800000, // DYNAMIC_FEE_FLAG
    tickSpacing: 60,
    hooks: IHooks(hookAddress)
});
adapter.registerRoute(key, "");
```

### Step 4: Deploy LP Liquidity Vaults
LPs deploy individual `V4LiquidityVault` instances linked to the pool and their configured tick range:
```solidity
V4LiquidityVault vault = new V4LiquidityVault(
    poolManagerAddress,
    key,
    tickLower,
    tickUpper,
    lpAddress,
    lpRouterAddress
);
```

---

## 4. Verification & Invariants Checklist

- [x] Invariant I1: `UniswapV4VenueAdapter` has 0 persistent token balance after swaps.
- [x] Invariant I2: `routeId` derived as `keccak256(abi.encode(PoolKey))` committed into terms salt.
- [x] Invariant I3: Post-expiry `settleToLp` executes without touching Uniswap v4.
- [x] Invariant I4: AMM swap fee is waived (`overrideFee = 0`) on settlement.
- [x] Gas Gate: Per-position overhead < 15% representative premium boundary.
