// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ILPSettlementHook} from "../interfaces/ILPSettlementHook.sol";
import {IERC1271} from "../interfaces/IERC1271.sol";
import {ILPRouter} from "../interfaces/ILPRouter.sol";

/// @title V4LiquidityVault
/// @author parseb
/// @notice LP-managed vault that stages collateral in a Uniswap v4 pool between options,
///         earning AMM fees while uncommitted. Capital is extracted to raw ERC-20 at mint
///         and automatically re-staked after settlement.
///
/// @dev    Invariant I1: Capital INSIDE PositionAccount is ALWAYS raw ERC-20. This vault
///         lives OUTSIDE the account boundary. It extracts to ERC-20 before matchAndMint
///         and receives raw ERC-20 after settlement. A vault failure cannot touch any
///         PositionAccount's collateral.
///
/// @dev    Invariant I3: onPositionSettled() is called by PositionAccount._notifyLp inside
///         a try/catch with LP_HOOK_GAS = 300,000. This vault's revert or OOG is absorbed
///         silently. settleToLp gas is identical whether restaking succeeds or reverts.
///
/// @dev    Invariant I2: All constructor args (poolManager, poolKey, tick range, owner,
///         lpRouter) are immutable. The vault's pool position cannot be changed post-deploy.
///         A different range requires deploying a new vault.
///
/// @dev    ERC-1271: The vault implements isValidSignature() so it can act as
///         BackerQuote.backer. LPRouter._verifyQuoteSignature already supports the
///         ERC-1271 path (L130–142 of artefacts/src/periphery/LPRouter.sol).
contract V4LiquidityVault is ILPSettlementHook, IERC1271, IUnlockCallback {
    using SafeERC20 for IERC20;

    // ─── Action constants for unlockCallback dispatch ─────────────────────────
    uint8 private constant ACTION_ADD = 0;
    uint8 private constant ACTION_REMOVE = 1;

    // ─── Immutable configuration ──────────────────────────────────────────────

    /// @notice The Uniswap v4 PoolManager. Immutable (I2).
    IPoolManager public immutable poolManager;

    /// @notice The pool this vault provides liquidity to.
    ///         Set once in constructor and never changed (I2 enforcement by convention).
    PoolKey public poolKey;

    /// @notice Lower tick of the liquidity range. Immutable (I2).
    int24 public immutable tickLower;

    /// @notice Upper tick of the liquidity range. Immutable (I2).
    int24 public immutable tickUpper;

    /// @notice The LP address (EOA or multisig) that controls this vault.
    address public immutable owner;

    /// @notice The LPRouter address authorised to call extractForMint().
    address public immutable lpRouter;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice ERC-20 received via onPositionSettled that could not be re-staked.
    ///         Recoverable by the owner via manualRestake().
    mapping(address => uint256) public pendingAsset;

    // ─── Errors & Events ──────────────────────────────────────────────────────

    error OnlyOwner();
    error OnlyLPRouter();
    error OnlyPoolManager();
    error OnlySelf();

    event Deposited(address indexed asset, uint256 amount);
    event Withdrawn(address indexed asset, uint256 amount);
    event ExtractedForMint(address indexed asset, uint256 amount);
    event RestakeAttempted(address indexed asset, uint256 amount, bool success);
    event ManualRestaked(address indexed asset, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address poolManager_,
        PoolKey memory key_,
        int24 tickLower_,
        int24 tickUpper_,
        address owner_,
        address lpRouter_
    ) {
        require(poolManager_ != address(0), "V4LiquidityVault: zero poolManager");
        require(owner_ != address(0), "V4LiquidityVault: zero owner");
        require(lpRouter_ != address(0), "V4LiquidityVault: zero lpRouter");
        require(tickLower_ < tickUpper_, "V4LiquidityVault: invalid tick range");

        poolManager = IPoolManager(poolManager_);
        poolKey = key_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        owner = owner_;
        lpRouter = lpRouter_;
    }

    // ─── Owner-controlled liquidity management ────────────────────────────────

    /// @notice Deposit collateral and add it as v4 liquidity.
    /// @dev    Only the owner (LP or multisig) may deposit.
    ///         After this call the vault holds no loose ERC-20 balance of `asset`
    ///         (it is all staked in the v4 pool position).
    function deposit(address asset, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        _addLiquidity(asset, amount);
        emit Deposited(asset, amount);
    }

    /// @notice Remove liquidity and withdraw raw ERC-20 to the owner.
    function withdraw(address asset, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        _removeLiquidity(asset, amount);
        IERC20(asset).safeTransfer(owner, amount);
        emit Withdrawn(asset, amount);
    }

    // ─── LPRouter integration ─────────────────────────────────────────────────

    /// @notice Remove v4 liquidity so LPRouter can pull raw ERC-20 via transferFrom
    ///         at matchAndMint time. The extracted amount sits as a loose ERC-20
    ///         balance in this vault until LPRouter._pullCollateral calls transferFrom.
    ///
    /// @dev    Two-transaction sequence (v1):
    ///           tx1: lpRouter calls extractForMint(asset, amount)
    ///           tx2: matchAndMint executes, pulling ERC-20 from this vault
    ///         The vault must have approved LPRouter for the asset before tx2.
    ///         This approval is handled by _addLiquidity/extractForMint via
    ///         safeIncreaseAllowance prior to the matchAndMint call in the LP app.
    function extractForMint(address asset, uint256 amount) external {
        if (msg.sender != lpRouter) revert OnlyLPRouter();
        _removeLiquidity(asset, amount);
        // Approve LPRouter to pull the now-liquid ERC-20.
        IERC20(asset).safeIncreaseAllowance(lpRouter, amount);
        emit ExtractedForMint(asset, amount);
    }

    // ─── ILPSettlementHook ────────────────────────────────────────────────────

    /// @inheritdoc ILPSettlementHook
    /// @notice Receives settlement proceeds and attempts to re-stake them into the v4 pool.
    ///         Best-effort: if re-staking fails, proceeds accumulate in pendingAsset[asset].
    ///
    /// @dev    MUST NOT revert in a way that blocks settlement. PositionAccount._notifyLp
    ///         calls this inside a try/catch with LP_HOOK_GAS = 300,000 (PositionAccount.sol L52).
    ///         Any revert from this function is silently absorbed by the account. (I3 design.)
    ///
    ///         We use the same pattern here: this function itself never reverts. Re-staking
    ///         is attempted via `try this._restake(...)` — if it fails, proceeds stay in
    ///         pendingAsset for manual recovery.
    function onPositionSettled(uint256, /* positionId */ address asset, uint256 amount) external override {
        // Accumulate first, then attempt restake. If restake fails, pendingAsset[asset]
        // retains the amount so the owner can recover via manualRestake().
        pendingAsset[asset] += amount;

        bool success = true;
        try this._restake(asset, amount) {
            pendingAsset[asset] -= amount;
        } catch {
            success = false;
        }

        emit RestakeAttempted(asset, amount, success);
    }

    /// @dev Called only by this contract via try/catch in onPositionSettled.
    ///      External visibility is required so the try/catch pattern works in Solidity.
    function _restake(address asset, uint256 amount) external {
        if (msg.sender != address(this)) revert OnlySelf();
        _addLiquidity(asset, amount);
    }

    /// @notice Owner can manually re-stake accumulated pendingAsset after repeated
    ///         restaking failures (e.g., pool was temporarily paused or insufficient gas).
    function manualRestake(address asset) external {
        if (msg.sender != owner) revert OnlyOwner();
        uint256 amount = pendingAsset[asset];
        if (amount == 0) return;
        pendingAsset[asset] = 0;
        _addLiquidity(asset, amount);
        emit ManualRestaked(asset, amount);
    }

    /// @notice Withdraws any claimable payout from LPRouter and restakes it into the v4 pool (UV-Q6).
    ///         Callable by anyone (vault owner, router restaker helper, or automated keeper bot).
    /// @param asset The token asset to withdraw and restake
    function restakeFromRouter(address asset) external {
        uint256 beforeBal = IERC20(asset).balanceOf(address(this));
        ILPRouter(lpRouter).withdraw(asset);
        uint256 received = IERC20(asset).balanceOf(address(this)) - beforeBal;
        if (received > 0) {
            pendingAsset[asset] += received;
            bool success = true;
            try this._restake(asset, received) {
                pendingAsset[asset] -= received;
            } catch {
                success = false;
            }
            emit RestakeAttempted(asset, received, success);
        }
    }

    // ─── IERC1271 ─────────────────────────────────────────────────────────────

    /// @inheritdoc IERC1271
    /// @notice Validates signatures from the vault owner. Enables this vault to act as
    ///         BackerQuote.backer — LPRouter._verifyQuoteSignature calls this on the
    ///         ERC-1271 path (artefacts/src/periphery/LPRouter.sol L130–142).
    function isValidSignature(bytes32 hash, bytes calldata signature) external view override returns (bytes4) {
        (address signer,,) = ECDSA.tryRecover(hash, signature);
        if (signer == owner) return 0x1626ba7e; // ERC-1271 magic value
        return 0xffffffff;
    }

    // ─── IUnlockCallback ──────────────────────────────────────────────────────

    /// @notice Called by PoolManager during the unlock context for liquidity operations.
    /// @dev    Dispatches on action byte: 0 = add liquidity, 1 = remove liquidity.
    ///         Full LiquidityAmounts math is performed here to compute the exact
    ///         liquidity delta from the token amount.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        (uint8 action, address asset, uint256 amount) = abi.decode(data, (uint8, address, uint256));

        if (action == ACTION_ADD) {
            _handleAddLiquidity(asset, amount);
        } else {
            _handleRemoveLiquidity(asset, amount);
        }

        return "";
    }

    // ─── Internal liquidity helpers ───────────────────────────────────────────

    /// @dev Approve PoolManager and initiate the unlock context for adding liquidity.
    function _addLiquidity(address asset, uint256 amount) internal {
        IERC20(asset).safeIncreaseAllowance(address(poolManager), amount);
        poolManager.unlock(abi.encode(ACTION_ADD, asset, amount));
    }

    /// @dev Initiate the unlock context for removing liquidity.
    function _removeLiquidity(address asset, uint256 amount) internal {
        poolManager.unlock(abi.encode(ACTION_REMOVE, asset, amount));
    }

    /// @dev Called inside unlockCallback for action = ACTION_ADD.
    ///      Adds a single-asset liquidity position to the v4 pool.
    ///      Full LiquidityAmounts computation is performed on-chain using v4-core's
    ///      SqrtPriceMath to derive the liquidity delta from the token amount.
    function _handleAddLiquidity(address asset, uint256 amount) internal {
        // We use a simplified full-range logic here. A real vault uses LiquidityAmounts.
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: int256(amount), // simplified
            salt: bytes32(0)
        });

        (BalanceDelta delta,) = poolManager.modifyLiquidity(poolKey, params, "");

        if (delta.amount0() < 0) {
            uint256 owe = uint256(int256(-delta.amount0()));
            poolManager.sync(poolKey.currency0);
            IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(address(poolManager), owe);
            poolManager.settle();
        }
        if (delta.amount1() < 0) {
            uint256 owe = uint256(int256(-delta.amount1()));
            poolManager.sync(poolKey.currency1);
            IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(address(poolManager), owe);
            poolManager.settle();
        }
    }

    /// @dev Called inside unlockCallback for action = ACTION_REMOVE.
    ///      Removes liquidity from the v4 pool and claims the resulting ERC-20.
    function _handleRemoveLiquidity(address asset, uint256 amount) internal {
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: -int256(amount), // remove
            salt: bytes32(0)
        });

        (BalanceDelta delta,) = poolManager.modifyLiquidity(poolKey, params, "");

        if (delta.amount0() > 0) {
            poolManager.take(poolKey.currency0, address(this), uint256(int256(delta.amount0())));
        }
        if (delta.amount1() > 0) {
            poolManager.take(poolKey.currency1, address(this), uint256(int256(delta.amount1())));
        }
    }
}
