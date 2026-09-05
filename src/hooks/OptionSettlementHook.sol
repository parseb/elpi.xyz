// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @dev Minimal interface for ERC-6551 token-bound accounts.
///      Used for PositionAccount verification — see _requireKnownPositionAccount().
interface IERC6551Account {
    /// @notice Returns the chain ID, token contract, and token ID this account is bound to.
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
}

/// @title OptionSettlementHook
/// @author parseb
/// @notice Uniswap v4 hook attached to the canonical option settlement pool.
///         Provides three capabilities to OptionCore:
///           1. Zero-fee waiver for PositionAccount settlement swaps (I4 protection).
///           2. Sender verification: only PositionAccounts get the waiver.
///           3. Internal flow netting: opposing flows in the same tx bypass the AMM curve
///              entirely (EIP-1153 transient storage, Cancun).
///
/// @dev    This contract implements IHooks directly (no BaseHook dependency) since
///         BaseHook lives in v4-periphery, not v4-core.
///
/// @dev    Hook flags required (encoded in the hook's deployed address):
///           BEFORE_SWAP                — fee waiver + sender check + netting
///           BEFORE_SWAP_RETURNS_DELTA  — custom delta for net-cross bypasses
///           AFTER_SWAP                 — informational SwapExecuted event
///
/// @dev    Invariant I2: The hook address is committed into PoolKey.hooks at pool creation,
///         and poolKey is committed into routeId = keccak256(abi.encode(poolKey)) at
///         LP profile signing. This hook cannot be replaced for a live position.
///
/// @dev    Invariant I4: overrideFee = 0 eliminates AMM fee deadweight on settlement,
///         so PositionAccount._feeAndPayout's feeBps is the sole fee on taker outflows.
///
/// @dev    Deployment: The hook address must satisfy Uniswap v4's flag bitmap. Use
///         script/MineHookSalt.s.sol to find a CREATE2 salt producing the correct
///         address prefix bits before deploying this contract.
contract OptionSettlementHook is IHooks {
    // ─── Netting entry (transient storage) ────────────────────────────────────

    struct NettingEntry {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        address recipient;
        bool exists;
    }

    // EIP-1153 transient storage implemented via TLOAD/TSTORE assembly.
    // Solidity 0.8.26 does not support the `transient` keyword for mappings;
    // we use inline assembly to read/write transient slots directly.
    // Slot key: keccak256(abi.encode(tokenIn, tokenOut)) — canonical ordering.
    //
    // Netting entry layout in transient storage (3 slots per key):
    //   slot+0: tokenIn  (address, lower 20 bytes)
    //   slot+1: amountIn (uint256)
    //   slot+2: packed(exists bool | recipient address) — exists in bit 160
    //
    // Reset at transaction boundary automatically (EIP-1153 semantics).

    function _tnetLoad(bytes32 key) internal view returns (NettingEntry memory entry) {
        bytes32 slot0 = keccak256(abi.encode("net", key, uint256(0)));
        bytes32 slot1 = keccak256(abi.encode("net", key, uint256(1)));
        bytes32 slot2 = keccak256(abi.encode("net", key, uint256(2)));
        uint256 s0;
        uint256 s1;
        uint256 s2;
        assembly {
            s0 := tload(slot0)
            s1 := tload(slot1)
            s2 := tload(slot2)
        }
        entry.tokenIn = address(uint160(s0));
        entry.amountIn = s1;
        entry.recipient = address(uint160(s2));
        entry.exists = (s2 >> 160) != 0;
    }

    function _tnetStore(bytes32 key, NettingEntry memory entry) internal {
        bytes32 slot0 = keccak256(abi.encode("net", key, uint256(0)));
        bytes32 slot1 = keccak256(abi.encode("net", key, uint256(1)));
        bytes32 slot2 = keccak256(abi.encode("net", key, uint256(2)));
        uint256 s0 = uint256(uint160(entry.tokenIn));
        uint256 s1 = entry.amountIn;
        uint256 s2 = uint256(uint160(entry.recipient)) | (entry.exists ? (1 << 160) : 0);
        assembly {
            tstore(slot0, s0)
            tstore(slot1, s1)
            tstore(slot2, s2)
        }
    }

    function _tnetDelete(bytes32 key) internal {
        bytes32 slot0 = keccak256(abi.encode("net", key, uint256(0)));
        bytes32 slot1 = keccak256(abi.encode("net", key, uint256(1)));
        bytes32 slot2 = keccak256(abi.encode("net", key, uint256(2)));
        assembly {
            tstore(slot0, 0)
            tstore(slot1, 0)
            tstore(slot2, 0)
        }
    }

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Registry of PositionManager contract addresses whose bound accounts
    ///         are eligible for the 0-fee waiver.
    ///         Populated by the owner at deployment; read-only thereafter per-position.
    mapping(address => bool) public knownPositionManagers;

    address public immutable owner;
    IPoolManager public immutable poolManager;

    // ─── Errors & Events ──────────────────────────────────────────────────────

    error InvalidOptionAccount(address sender);
    error OnlyOwner();
    error OnlyPoolManager();

    /// @notice Emitted after every settlement swap (informational only, never reverts).
    event SwapExecuted(uint256 indexed timestamp, int128 amount0, int128 amount1);

    /// @notice Emitted when two opposing flows are netted internally (AMM bypassed).
    event NetCross(address indexed posA, address indexed posB, address asset, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(IPoolManager _poolManager, address _owner) {
        poolManager = _poolManager;
        owner = _owner;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Register a PositionManager address as trusted. Its bound accounts
    ///         (ERC-6551 tokens) will pass sender verification and receive the fee waiver.
    function addPositionManager(address pm) external {
        if (msg.sender != owner) revert OnlyOwner();
        knownPositionManagers[pm] = true;
    }

    /// @notice Remove a PositionManager from the trusted set.
    function removePositionManager(address pm) external {
        if (msg.sender != owner) revert OnlyOwner();
        knownPositionManagers[pm] = false;
    }

    // ─── IHooks — stubs for unused hooks (return correct selectors) ───────────

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.afterDonate.selector;
    }

    // ─── beforeSwap ───────────────────────────────────────────────────────────

    /// @notice Called by PoolManager before every swap on this hook's pool.
    /// @dev    Step 1: Verify the sender is a PositionAccount bound to a known
    ///                 PositionManager (ERC-6551 token() introspection).
    ///         Step 2: Return overrideFee = 0 (I4: AMM fee waiver for settlement).
    ///         Step 3: Check transient netting buffer for an opposing flow.
    ///                 If found: cross at current price, return custom BeforeSwapDelta
    ///                           that bypasses the AMM curve entirely.
    ///                 If not found: store this flow in the buffer, proceed normally.
    function beforeSwap(address sender, PoolKey calldata, SwapParams calldata params, bytes calldata hookData)
        external
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // ── Step 1: Sender verification ─────────────────────────────────────
        // Try ERC-6551 token() to confirm sender is a PositionAccount.
        // On failure (EOA, non-ERC-6551 contract): revert.
        // On success: check tokenContract is in knownPositionManagers.
        //
        // Security note: a malicious contract could spoof token() to return a known
        // PositionManager's address. The worst-case gain is a 0-fee swap on this pool —
        // it cannot affect any PositionAccount's collateral (I1). The whitelist approach
        // costs ~800 gas (SLOAD) vs ~5k for full per-call TermsLib.deriveAccount.
        _requireKnownPositionAccount(sender);

        // ── Step 2: Zero-fee waiver ──────────────────────────────────────────
        // overrideFee = 0 eliminates AMM fee for settlement swaps.
        // Requires pool created with DYNAMIC_FEE_FLAG (0x800000) in PoolKey.fee.
        uint24 overrideFee = 0;

        // ── Step 3: Internal flow netting (EIP-1153 transient storage) ───────
        // Decode tokenIn/tokenOut from params.amountSpecified sign and hookData.
        // hookData encodes (address tokenIn, address tokenOut, address recipient)
        // for netting purposes. If hookData is empty or wrong length, skip netting.
        BeforeSwapDelta netDelta = _tryNet(sender, params, hookData);

        return (IHooks.beforeSwap.selector, netDelta, overrideFee);
    }

    // ─── afterSwap ────────────────────────────────────────────────────────────

    /// @notice Called by PoolManager after every swap. Informational only — never reverts.
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta delta, bytes calldata)
        external
        override
        returns (bytes4, int128)
    {
        // Informational: emit the amounts for off-chain price tracking (§9.1).
        emit SwapExecuted(block.timestamp, delta.amount0(), delta.amount1());
        return (IHooks.afterSwap.selector, 0);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Verifies that `sender` is a PositionAccount bound to a known PositionManager.
    ///      Reverts with InvalidOptionAccount if verification fails.
    function _requireKnownPositionAccount(address sender) internal view {
        if (sender.code.length == 0) revert InvalidOptionAccount(sender);
        try IERC6551Account(sender).token() returns (uint256, address tokenContract, uint256) {
            if (!knownPositionManagers[tokenContract]) revert InvalidOptionAccount(sender);
        } catch {
            revert InvalidOptionAccount(sender);
        }
    }

    /// @dev Attempt internal netting via transient storage.
    ///      If hookData encodes (tokenIn, tokenOut, recipient) and an opposing flow
    ///      exists in pendingNets, execute a net-cross and return a custom delta.
    ///      Otherwise store this flow and return zero delta (normal AMM path).
    function _tryNet(address sender, SwapParams calldata params, bytes calldata hookData)
        internal
        returns (BeforeSwapDelta)
    {
        // Netting requires hook data encoding (tokenIn, tokenOut, recipient).
        // If absent or wrong length, skip netting entirely.
        if (hookData.length < 96) {
            return toBeforeSwapDelta(0, 0);
        }

        (address tokenIn, address tokenOut, address recipient) = abi.decode(hookData, (address, address, address));

        bytes32 myKey = keccak256(abi.encode(tokenIn, tokenOut));
        bytes32 oppKey = keccak256(abi.encode(tokenOut, tokenIn));

        NettingEntry memory opposing = _tnetLoad(oppKey);

        if (opposing.exists) {
            uint256 netAmount =
                params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            uint256 crossAmount = netAmount < opposing.amountIn ? netAmount : opposing.amountIn;

            // Clear the opposing entry from transient storage.
            _tnetDelete(oppKey);

            emit NetCross(sender, opposing.recipient, tokenIn, crossAmount);

            // Return a custom BeforeSwapDelta that tells PoolManager we handled
            // this flow internally (net-zero: specifiedDelta = amountIn, unspecifiedDelta = 0).
            return toBeforeSwapDelta(int128(int256(crossAmount)), 0);
        } else {
            // No opposing flow: store this flow in transient storage for potential netting.
            uint256 amount =
                params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            _tnetStore(
                myKey,
                NettingEntry({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: amount,
                    recipient: recipient,
                    exists: true
                })
            );
            return toBeforeSwapDelta(0, 0);
        }
    }
}
