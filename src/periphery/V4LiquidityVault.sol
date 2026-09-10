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

    /// @notice Thrown when action is restricted to vault owner.
    error OnlyOwner();

    /// @notice Thrown when action is restricted to the authorized LPRouter.
    error OnlyLPRouter();

    /// @notice Thrown when unlockCallback is called by an unauthorized address.
    error OnlyPoolManager();

    /// @notice Thrown when internal callback is called externally.
    error OnlySelf();

    /// @notice Thrown when a zero address parameter is supplied where prohibited.
    error ZeroAddress();

    /// @notice Thrown when an amount parameter is zero.
    error ZeroAmount();

    /// @notice Thrown when tickLower >= tickUpper.
    error InvalidTickRange();

    /// @notice Emitted when collateral is deposited into the vault and staged in v4.
    /// @param asset The ERC-20 token address.
    /// @param amount The deposited amount.
    event Deposited(address indexed asset, uint256 amount);

    /// @notice Emitted when collateral is withdrawn to owner.
    /// @param asset The ERC-20 token address.
    /// @param amount The withdrawn amount.
    event Withdrawn(address indexed asset, uint256 amount);

    /// @notice Emitted when liquid ERC-20 is extracted for option minting.
    /// @param asset The ERC-20 token address.
    /// @param amount The extracted amount.
    event ExtractedForMint(address indexed asset, uint256 amount);

    /// @notice Emitted on an auto-restake attempt after position settlement.
    /// @param asset The ERC-20 token address.
    /// @param amount The restake amount.
    /// @param success Whether restaking succeeded or accumulated in pendingAsset.
    event RestakeAttempted(address indexed asset, uint256 amount, bool success);

    /// @notice Emitted when owner manually restakes pending assets.
    /// @param asset The ERC-20 token address.
    /// @param amount The restaked amount.
    event ManualRestaked(address indexed asset, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @notice Initializes the V4LiquidityVault.
    /// @param poolManager_ The Uniswap v4 PoolManager contract.
    /// @param key_ The PoolKey representing the v4 pool.
    /// @param tickLower_ The lower tick boundary for staging liquidity.
    /// @param tickUpper_ The upper tick boundary for staging liquidity.
    /// @param owner_ The LP owner address.
    /// @param lpRouter_ The LPRouter address authorized for extractForMint.
    constructor(
        address poolManager_,
        PoolKey memory key_,
        int24 tickLower_,
        int24 tickUpper_,
        address owner_,
        address lpRouter_
    ) {
        if (poolManager_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0)) revert ZeroAddress();
        if (lpRouter_ == address(0)) revert ZeroAddress();
        if (tickLower_ >= tickUpper_) revert InvalidTickRange();

        poolManager = IPoolManager(poolManager_);
        poolKey = key_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        owner = owner_;
        lpRouter = lpRouter_;
    }

    // ─── Owner-controlled liquidity management ────────────────────────────────

    /// @notice Deposit collateral and add it as v4 liquidity.
    /// @param asset Address of the ERC-20 collateral.
    /// @param amount Amount to deposit.
    /// @dev Only the owner (LP or multisig) may deposit.
    ///      After this call the vault holds no loose ERC-20 balance of `asset`
    ///      (it is all staked in the v4 pool position).
    function deposit(address asset, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (asset == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        _addLiquidity(asset, amount);
        emit Deposited(asset, amount);
    }

    /// @notice Remove liquidity and withdraw raw ERC-20 to the owner.
    /// @param asset Address of the ERC-20 collateral.
    /// @param amount Amount to withdraw.
    function withdraw(address asset, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (asset == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _removeLiquidity(asset, amount);
        IERC20(asset).safeTransfer(owner, amount);
        emit Withdrawn(asset, amount);
    }

    // ─── LPRouter integration ─────────────────────────────────────────────────

    /// @notice Atomically removes v4 liquidity and transfers raw ERC-20 directly to
    ///         the authorized LPRouter at matchAndMint time (1-Tx Mint).
    /// @param asset Address of the ERC-20 collateral to extract.
    /// @param amount Amount to extract.
    /// @dev Single-transaction atomic extraction (Compromise Architecture):
    ///      LPRouter calls extractForMint during _pullCollateral in matchAndMint,
    ///      receiving pure ERC-20 tokens immediately without an approval hop.
    function extractForMint(address asset, uint256 amount) external {
        if (msg.sender != lpRouter) revert OnlyLPRouter();
        if (asset == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _removeLiquidity(asset, amount);
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit ExtractedForMint(asset, amount);
    }

    // ─── ILPSettlementHook ────────────────────────────────────────────────────

    /// @inheritdoc ILPSettlementHook
    /// @notice Receives settlement proceeds and attempts to re-stake them into the v4 pool.
    ///         Best-effort: if re-staking fails, proceeds accumulate in pendingAsset[asset].
    /// @param asset Address of settlement asset received.
    /// @param amount Amount of settlement proceeds received.
    /// @dev MUST NOT revert in a way that blocks settlement. PositionAccount._notifyLp
    ///      calls this inside a try/catch with LP_HOOK_GAS = 300,000.
    function onPositionSettled(uint256, /* positionId */ address asset, uint256 amount) external override {
        if (amount == 0 || asset == address(0)) return;

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

    /// @notice Internal restake helper called via external try/catch.
    /// @param asset Address of asset to restake.
    /// @param amount Amount to restake into v4 pool.
    function _restake(address asset, uint256 amount) external {
        if (msg.sender != address(this)) revert OnlySelf();
        _addLiquidity(asset, amount);
    }

    /// @notice Owner can manually re-stake accumulated pendingAsset after repeated
    ///         restaking failures.
    /// @param asset Address of asset to restake.
    function manualRestake(address asset) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (asset == address(0)) revert ZeroAddress();

        uint256 amount = pendingAsset[asset];
        if (amount == 0) return;
        pendingAsset[asset] = 0;
        _addLiquidity(asset, amount);
        emit ManualRestaked(asset, amount);
    }

    /// @notice Withdraws any claimable payout from LPRouter and restakes it into the v4 pool (UV-Q6).
    ///         Callable by anyone (vault owner, router restaker helper, or automated keeper bot).
    /// @param asset The token asset to withdraw and restake.
    function restakeFromRouter(address asset) external {
        if (asset == address(0)) revert ZeroAddress();

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
    ///         BackerQuote.backer.
    /// @param hash The digest signed.
    /// @param signature The signature bytes.
    /// @return magicValue 0x1626ba7e if valid, 0xffffffff otherwise.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view override returns (bytes4) {
        (address signer,,) = ECDSA.tryRecover(hash, signature);
        if (signer == owner) return 0x1626ba7e; // ERC-1271 magic value
        return 0xffffffff;
    }

    // ─── IUnlockCallback ──────────────────────────────────────────────────────

    /// @inheritdoc IUnlockCallback
    /// @notice Called by PoolManager during the unlock context for liquidity operations.
    /// @param data ABI-encoded action byte, asset address, and amount.
    /// @return Empty bytes.
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
        IERC20(asset).forceApprove(address(poolManager), amount);
        poolManager.unlock(abi.encode(ACTION_ADD, asset, amount));
    }

    /// @dev Initiate the unlock context for removing liquidity.
    function _removeLiquidity(address asset, uint256 amount) internal {
        poolManager.unlock(abi.encode(ACTION_REMOVE, asset, amount));
    }

    /// @dev Called inside unlockCallback for action = ACTION_ADD.
    function _handleAddLiquidity(address, uint256 amount) internal {
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: int256(amount),
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
    function _handleRemoveLiquidity(address, uint256 amount) internal {
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: -int256(amount),
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
