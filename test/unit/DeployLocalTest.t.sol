// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployLocal} from "../../script/DeployLocal.s.sol";
import {MockPriceOracle} from "../../src/mocks/MockPriceOracle.sol";
import {MockSettlementVenue} from "../../src/mocks/MockSettlementVenue.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

contract DeployLocalTest is Test {
    DeployLocal internal deployScript;
    DeployLocal.LocalDeployment internal d;

    function setUp() public {
        deployScript = new DeployLocal();
        d = deployScript.deployLocalStack(deployScript.DEPLOYER());
    }

    function test_deployLocalStack_endToEnd() public view {
        // Assert tokens
        assertTrue(address(d.weth) != address(0), "WETH zero");
        assertTrue(address(d.wbtc) != address(0), "WBTC zero");
        assertTrue(address(d.usdc) != address(0), "USDC zero");
        assertEq(d.weth.decimals(), 18, "WETH decimals mismatch");
        assertEq(d.wbtc.decimals(), 8, "WBTC decimals mismatch");
        assertEq(d.usdc.decimals(), 6, "USDC decimals mismatch");

        // Assert oracles
        (uint256 wethPrice, uint256 wethUpdated) = d.wethOracle.getPrice();
        assertEq(wethPrice, 3000 * 1e18, "WETH initial price mismatch");
        assertEq(wethUpdated, block.timestamp, "WETH initial timestamp mismatch");

        (uint256 wbtcPrice,) = d.wbtcOracle.getPrice();
        assertEq(wbtcPrice, 60000 * 1e18, "WBTC initial price mismatch");

        // Assert venue
        assertTrue(address(d.mockVenue) != address(0), "Venue zero");
        assertEq(d.mockVenue.rateNumerator(), 3000 * 1e6, "Venue rateNumerator mismatch");
        assertEq(d.mockVenue.rateDenominator(), 1e18, "Venue rateDenominator mismatch");

        // Assert Uniswap v4 stack & liquidity collateralization
        assertTrue(address(d.poolManager) != address(0), "PoolManager zero");
        assertTrue(address(d.venueAdapter) != address(0), "Adapter zero");
        assertTrue(address(d.hook) != address(0), "Hook zero");
        assertTrue(address(d.vault) != address(0), "Vault zero");
        assertEq(d.vault.owner(), deployScript.LP_PERSONA(), "Vault owner mismatch");
        assertEq(d.vault.lpRouter(), deployScript.DEPLOYER(), "Vault router mismatch");

        // Assert persona balances (LP deposited 25 WETH into vault, leaving 75 WETH liquid)
        assertEq(d.weth.balanceOf(deployScript.LP_PERSONA()), 75 * 1e18, "LP WETH liquid balance");
        assertEq(
            d.weth.balanceOf(address(d.vault)) + d.weth.balanceOf(address(d.poolManager)),
            25 * 1e18,
            "Vault + PoolManager total staged WETH"
        );
        assertGt(d.weth.balanceOf(address(d.poolManager)), 0, "PoolManager has v4 liquidity token0");
        assertEq(d.usdc.balanceOf(deployScript.LP_PERSONA()), 100_000 * 1e6, "LP USDC balance");
        assertEq(d.weth.balanceOf(deployScript.TAKER_PERSONA()), 50 * 1e18, "Taker WETH balance");
        assertEq(d.usdc.balanceOf(deployScript.TAKER_PERSONA()), 50_000 * 1e6, "Taker USDC balance");
        assertEq(d.weth.balanceOf(deployScript.TAKER2_PERSONA()), 50 * 1e18, "Taker 2 WETH balance");
        assertEq(d.usdc.balanceOf(deployScript.TAKER2_PERSONA()), 50_000 * 1e6, "Taker 2 USDC balance");

        // Assert allowances pre-seeded
        assertEq(d.weth.allowance(deployScript.LP_PERSONA(), address(d.vault)), type(uint256).max, "LP vault WETH allowance");
        assertEq(d.weth.allowance(deployScript.TAKER_PERSONA(), address(d.venueAdapter)), type(uint256).max, "Taker adapter WETH allowance");
        assertEq(d.usdc.allowance(deployScript.TAKER_PERSONA(), address(d.venueAdapter)), type(uint256).max, "Taker adapter USDC allowance");
        assertEq(d.weth.allowance(deployScript.TAKER2_PERSONA(), address(d.venueAdapter)), type(uint256).max, "Taker 2 adapter WETH allowance");
        assertEq(d.usdc.allowance(deployScript.TAKER2_PERSONA(), address(d.venueAdapter)), type(uint256).max, "Taker 2 adapter USDC allowance");

        // Assert raw hash addresses also received token mints
        assertEq(d.weth.balanceOf(deployScript.ELPI1_HASH_ADDR()), 10 * 1e18, "LP hash WETH balance");
        assertEq(d.usdc.balanceOf(deployScript.ELPI1_HASH_ADDR()), 10_000 * 1e6, "LP hash USDC balance");
    }

    function test_mockPriceOracle_setPrice_and_freshness() public {
        uint256 maxPriceAge = 1800; // 30 mins

        // Move price +10% (from 3000 to 3300)
        uint256 newPrice = 3300 * 1e18;
        d.wethOracle.setPrice(newPrice, block.timestamp);

        (uint256 fetchedPrice, uint256 updatedAt) = d.wethOracle.price(address(d.weth), address(d.usdc));
        assertEq(fetchedPrice, newPrice, "Price update failed");
        assertEq(updatedAt, block.timestamp, "UpdatedAt mismatch");

        // Test Chainlink latestRoundData conversion to 8 decimals
        (, int256 chainlinkAnswer,,,) = d.wethOracle.latestRoundData();
        assertEq(chainlinkAnswer, 3300 * 1e8, "Chainlink 8-decimal answer mismatch");

        // Advance time beyond maxPriceAge
        vm.warp(block.timestamp + 2000);
        uint256 age = block.timestamp - updatedAt;
        assertTrue(age > maxPriceAge, "Should be stale");

        // Test revert flag for Invariant I3 verification
        d.wethOracle.setShouldRevert(true);
        vm.expectRevert(MockPriceOracle.OracleReverting.selector);
        d.wethOracle.price(address(d.weth), address(d.usdc));
    }

    function test_mockSettlementVenue_rateSync_and_swap() public {
        address trader = makeAddr("trader");
        d.weth.mint(trader, 10 * 1e18);

        // Sync venue rate to 3500 USDC per WETH
        // numerator = (3500 * 1e18 * 1e6) / 1e18 = 3500 * 1e6
        // denominator = 1e18
        d.mockVenue.setRate(3500 * 1e6, 1e18);

        // Trader swaps 2 WETH
        uint256 amountIn = 2 * 1e18;
        uint256 expectedOut = 7000 * 1e6; // 2 * 3500 USDC

        vm.startPrank(trader);
        d.weth.approve(address(d.mockVenue), amountIn);
        uint256 amountOut =
            d.mockVenue.swap(address(d.weth), address(d.usdc), amountIn, expectedOut, block.timestamp + 60, bytes32(0));
        vm.stopPrank();

        assertEq(amountOut, expectedOut, "Swap amountOut mismatch");
        assertEq(d.usdc.balanceOf(trader), expectedOut, "Trader USDC balance mismatch");

        // Slippage revert test: request higher minAmountOut than rate permits
        vm.startPrank(trader);
        d.weth.approve(address(d.mockVenue), 1e18);
        vm.expectRevert("MockSettlementVenue: slippage exceeded");
        d.mockVenue.swap(
            address(d.weth),
            address(d.usdc),
            1e18,
            3501 * 1e6, // too high
            block.timestamp + 60,
            bytes32(0)
        );
        vm.stopPrank();
    }

    function test_stalenessDecoupling_advanceAndRefresh() public {
        uint256 maxPriceAge = 1800; // 30m

        // Initial state: fresh
        (, uint256 initialUpdated) = d.wethOracle.getPrice();
        assertEq(initialUpdated, block.timestamp);

        // Advance 1 day (evm_increaseTime simulation)
        vm.warp(block.timestamp + 86400);

        // Oracle timestamp is now 1 day stale
        (, uint256 staleUpdated) = d.wethOracle.getPrice();
        assertEq(staleUpdated, initialUpdated);
        assertTrue(block.timestamp - staleUpdated > maxPriceAge, "Must be stale");

        // Run refresh: updates timestamp without altering price
        (uint256 curPrice,) = d.wethOracle.getPrice();
        d.wethOracle.setPrice(curPrice, block.timestamp);

        (, uint256 refreshedUpdated) = d.wethOracle.getPrice();
        assertEq(refreshedUpdated, block.timestamp, "Must match current block timestamp");
        assertFalse(block.timestamp - refreshedUpdated > maxPriceAge, "Staleness must be cleared");
    }
}
