// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISettlementVenue} from "../interfaces/ISettlementVenue.sol";

/// @title UniswapV4VenueAdapter
/// @author parseb
/// @notice ISettlementVenue adapter over Uniswap v4 PoolManager (flash-accounting).
///         routeId = keccak256(abi.encode(PoolKey)) — see OH_UNISWAP_SPECIFICATION.md §3.3.
///
/// @dev Invariant I2: PoolManager address is immutable. The route registry is append-only —
///      a registered routeId can never have its PoolKey changed. Changing a pool's semantics
///      requires a new PoolKey → new routeId → new LP profile.
///
/// @dev Invariant I1: This adapter never holds a persistent ERC-20 balance. tokenIn is
///      pulled from msg.sender, forwarded to PoolManager via settle(), and tokenOut is
///      delivered directly to msg.sender via take(). The adapter's balance is always zero
///      before and after any call.
///
/// @dev Invariant I3: This adapter is called only from PositionAccount._settleToTakerCall
///      and _settleToTakerPut (the venue-dependent path). The oracle-free settleToLp path
///      never touches this contract.
///
/// @dev Invariant I4: No fee is withheld by this adapter. The OptionSettlementHook
///      (UV2) provides a 0-fee waiver so AMM fees do not erode the taker payout before
///      PositionAccount._feeAndPayout applies feeBps.
contract UniswapV4VenueAdapter is ISettlementVenue, IUnlockCallback {
    using SafeERC20 for IERC20;

    /// @notice The Uniswap v4 PoolManager. Immutable — cannot be changed after deployment.
    IPoolManager public immutable poolManager;

    /// @dev Pool key registry: routeId → PoolKey.
    ///      Populated by registerRoute(); read-only thereafter (I2 enforcement).
    mapping(bytes32 => PoolKey) public poolKeyOf;

    /// @dev Optional hook call data per route (passed to PoolManager.swap as hookData).
    ///      Stored separately to avoid struct-packing issues with variable-length bytes.
    mapping(bytes32 => bytes) public hookDataOf;

    /// @dev Transient callback data passed from swap() into unlockCallback().
    ///      Encoded as abi.encode(SwapCallbackData) inside poolManager.unlock().
    struct SwapCallbackData {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes32 routeId;
        address recipient; // PositionAccount — output delivered directly to it (no extra hop)
    }

    error SwapExpired(uint256 deadline, uint256 current);
    error SlippageExceeded(uint256 received, uint256 minimum);
    error UnknownRoute(bytes32 routeId);
    error RouteAlreadyRegistered(bytes32 routeId);
    error OnlyPoolManager();
    error ZeroAddress();

    event RouteRegistered(bytes32 indexed routeId, PoolKey key);

    constructor(address poolManager_) {
        if (poolManager_ == address(0)) revert ZeroAddress();
        poolManager = IPoolManager(poolManager_);
    }

    /// @notice Register a PoolKey under routeId = keccak256(abi.encode(key)).
    /// @dev    Idempotent only if the key exactly matches the existing registration.
    ///         A registered route can NEVER have its PoolKey changed — only confirmed
    ///         or rejected (I2 enforcement). Any new pool config requires a new routeId.
    ///
    ///         When key.hooks != address(0) (UV2 hook-attached pools), this function
    ///         verifies DYNAMIC_FEE_FLAG (0x800000) is set in key.fee, since the hook's
    ///         0-fee waiver only works with dynamic-fee pools (spec caveat §3.4).
    function registerRoute(PoolKey calldata key, bytes calldata hookData) external {
        bytes32 routeId = keccak256(abi.encode(key));
        PoolKey storage existing = poolKeyOf[routeId];

        // tickSpacing == 0 is the sentinel for an unregistered slot (valid pools
        // always have non-zero tickSpacing).
        if (existing.tickSpacing != 0) {
            // Confirm identical re-registration (idempotent), reject mismatches.
            bool identical = Currency.unwrap(existing.currency0) == Currency.unwrap(key.currency0)
                && Currency.unwrap(existing.currency1) == Currency.unwrap(key.currency1) && existing.fee == key.fee
                && existing.tickSpacing == key.tickSpacing && address(existing.hooks) == address(key.hooks);
            if (!identical) revert RouteAlreadyRegistered(routeId);
            return; // already registered with same key — no-op
        }

        // For hook-attached pools (UV2+): enforce DYNAMIC_FEE_FLAG so the hook's
        // fee override actually takes effect (spec §3.4 caveat, I4 protection).
        if (address(key.hooks) != address(0)) {
            require(key.fee & 0x800000 != 0, "UniswapV4VenueAdapter: hook pool must use DYNAMIC_FEE_FLAG");
        }

        poolKeyOf[routeId] = key;
        hookDataOf[routeId] = hookData;
        emit RouteRegistered(routeId, key);
    }

    /// @inheritdoc ISettlementVenue
    /// @dev Pulls amountIn from the calling PositionAccount, executes a v4 flash-accounting
    ///      swap, and delivers amountOut directly back to the PositionAccount.
    ///      The adapter's ERC-20 balance is zero before and after this call (I1).
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId
    ) external override returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert SwapExpired(deadline, block.timestamp);

        // tickSpacing == 0 sentinel: unregistered route.
        if (poolKeyOf[routeId].tickSpacing == 0) revert UnknownRoute(routeId);

        // Pull tokenIn from the calling PositionAccount into this adapter.
        // Held transiently inside the unlock context only — zero balance after return.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        bytes memory result = poolManager.unlock(
            abi.encode(
                SwapCallbackData({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: amountIn,
                    minAmountOut: minAmountOut,
                    routeId: routeId,
                    recipient: msg.sender // output goes directly to PositionAccount
                })
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    /// @inheritdoc ISettlementVenue
    /// @dev Advisory only — real pre-trade quotes use Uniswap QuoterV2 off-chain (§6.1).
    ///      This function satisfies the interface; it is never the source of minAmountOut
    ///      for a real swap (that would violate I4 — only IPriceOracle.price() may set
    ///      the oracle floor).
    function quote(address, address, uint256, bytes32) external pure override returns (uint256) {
        return 0;
    }

    /// @notice Called by PoolManager during the unlock context. Executes the actual v4 swap
    ///         and settles flash-accounting balances.
    /// @dev    Only callable by the PoolManager (onlyPoolManager guard — I1 protection against
    ///         reentrancy: adapter holds no persistent balance, so re-entering gains nothing,
    ///         but the guard prevents any external code from triggering callback logic).
    ///
    /// @dev    Hook verification design:
    ///         In Uniswap v4, `beforeSwap(address sender, ...)` receives `msg.sender` of
    ///         `poolManager.swap()`. Because the adapter calls swap() inside unlockCallback,
    ///         `sender` == address(this) (the adapter), NOT the PositionAccount.
    ///
    ///         Resolution (spec §3.2 intent preserved): the adapter dynamically prepends the
    ///         PositionAccount address (d.recipient) to the hookData bytes before passing them
    ///         to poolManager.swap(). The OptionSettlementHook trusts this adapter and decodes
    ///         the first 32 bytes as the PositionAccount to verify via ERC-6551 introspection.
    ///
    ///         Security: this does NOT weaken the security model. Only a genuine
    ///         poolManager.unlock() context can reach this function (onlyPoolManager guard),
    ///         and d.recipient is set to msg.sender of the outer swap() call — the real
    ///         PositionAccount. A caller cannot forge a different recipient without controlling
    ///         tokenIn transfers from that address (which would fail at safeTransferFrom).
    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        SwapCallbackData memory d = abi.decode(rawData, (SwapCallbackData));
        PoolKey memory key = poolKeyOf[d.routeId];

        // Build dynamic hookData: prepend the PositionAccount address so the hook can
        // verify it via ERC-6551. Concatenated as abi.encode(positionAccount) + storedHookData.
        // The hook decodes the leading 32 bytes as the PositionAccount, then optionally
        // uses any trailing bytes as route-specific data.
        bytes memory storedHookData = hookDataOf[d.routeId];
        bytes memory hData = bytes.concat(abi.encode(d.recipient), storedHookData);

        // Determine swap direction. v4 requires currency0 < currency1 by address,
        // so currency0 == tokenIn means we are selling currency0 for currency1.
        bool zeroForOne = Currency.unwrap(key.currency0) == d.tokenIn;

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(d.amountIn), // negative = exact-input mode
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            hData
        );

        // Extract output amount from the delta. The sign convention in v4:
        //   delta.amount0() > 0 means the pool owes us currency0 (we received it)
        //   delta.amount1() > 0 means the pool owes us currency1 (we received it)
        uint256 amountOut = zeroForOne ? uint256(int256(delta.amount1())) : uint256(int256(delta.amount0()));

        // Double-enforce minAmountOut: PositionAccount._oracleFloor already checked it
        // before calling swap(); we re-check here inside the flash context to prevent
        // any timing gap between the two checks.
        if (amountOut < d.minAmountOut) revert SlippageExceeded(amountOut, d.minAmountOut);

        // Flash-accounting settlement:
        // sync() must be called before safeTransfer so PoolManager accounts for the ERC-20.
        poolManager.sync(Currency.wrap(d.tokenIn));
        IERC20(d.tokenIn).safeTransfer(address(poolManager), d.amountIn);
        poolManager.settle();

        // Claim tokenOut and deliver it directly to the PositionAccount.
        // No intermediate hop through this adapter (I1: persistent-balance invariant).
        poolManager.take(zeroForOne ? key.currency1 : key.currency0, d.recipient, amountOut);

        return abi.encode(amountOut);
    }
}
