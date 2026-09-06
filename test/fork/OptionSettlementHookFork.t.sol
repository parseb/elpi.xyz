// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import {OptionSettlementHook} from "../../src/hooks/OptionSettlementHook.sol";
import {UniswapV4VenueAdapter} from "../../src/adapters/UniswapV4VenueAdapter.sol";
import {TestERC20} from "../unit/mocks/TestERC20.sol";

contract Mock6551Account {
    address public immutable tokenContract;

    constructor(address _tokenContract) {
        tokenContract = _tokenContract;
    }

    function token() external view returns (uint256, address, uint256) {
        return (block.chainid, tokenContract, 0);
    }
}

/// @title OptionSettlementHookFork
/// @notice Fork verification for Milestone UV2 (§8.2).
///         Tests OptionSettlementHook 0-fee waiver and PositionAccount authentication.
contract OptionSettlementHookFork is Test {
    IPoolManager public poolManager;
    UniswapV4VenueAdapter public adapter;
    OptionSettlementHook public hook;
    PoolKey public poolKey;
    bytes32 public routeId;

    address public owner = makeAddr("owner");
    address public knownPM = makeAddr("knownPositionManager");
    Mock6551Account public positionAccount;

    TestERC20 public token0;
    TestERC20 public token1;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpcUrl).length > 0) {
            vm.createSelectFork(rpcUrl);
            address canonicalPm = vm.envOr("POOL_MANAGER", address(0));
            if (canonicalPm != address(0) && canonicalPm.code.length > 0) {
                poolManager = IPoolManager(canonicalPm);
            } else {
                poolManager = IPoolManager(address(new PoolManager(address(0))));
            }
        } else {
            poolManager = IPoolManager(address(new PoolManager(address(0))));
        }

        token0 = new TestERC20("Token 0", "T0", 18);
        token1 = new TestERC20("Token 1", "T1", 18);
        if (address(token0) > address(token1)) {
            TestERC20 temp = token0;
            token0 = token1;
            token1 = temp;
        }

        adapter = new UniswapV4VenueAdapter(address(poolManager));

        // Deploy hook at flag-correct address 0x...C8
        OptionSettlementHook realHook = new OptionSettlementHook(poolManager, owner, address(adapter));
        address hookAddress = address(0x00000000000000000000000000000000000000C8);
        vm.etch(hookAddress, address(realHook).code);
        hook = OptionSettlementHook(hookAddress);

        vm.prank(owner);
        hook.addPositionManager(knownPM);

        positionAccount = new Mock6551Account(knownPM);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 0x800000, // DYNAMIC_FEE_FLAG
            tickSpacing: 60,
            hooks: hook
        });

        try poolManager.initialize(poolKey, 79228162514264337593543950336) {} catch {}
        adapter.registerRoute(poolKey, "");
        routeId = keccak256(abi.encode(poolKey));
    }

    /// @notice Validates 0-fee waiver returned for authentic PositionAccount
    function test_fork_hook_feeWaiver_validAccount() public {
        vm.prank(address(positionAccount));
        (bytes4 selector, BeforeSwapDelta delta, uint24 feeOverride) = hook.beforeSwap(
            address(positionAccount),
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0}),
            ""
        );

        assertEq(selector, hook.beforeSwap.selector, "Selector matches");
        assertEq(BeforeSwapDelta.unwrap(delta), 0, "No net-delta when no opposing flow");
        // Fee override must be exactly 0 (0 AMM swap fee waiver, Invariant I4)
        assertEq(feeOverride, 0, "0 AMM fee waiver returned for valid PositionAccount");
    }

    /// @notice Adversarial test: unverified callers MUST revert with InvalidOptionAccount
    function test_fork_hook_rejects_adversarialCaller() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);

        vm.expectRevert(abi.encodeWithSelector(OptionSettlementHook.InvalidOptionAccount.selector, attacker));
        hook.beforeSwap(
            attacker, poolKey, SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0}), ""
        );
    }
}
