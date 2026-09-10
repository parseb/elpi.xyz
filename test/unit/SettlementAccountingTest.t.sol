// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import {PositionAccount, ActionContext, ActionKind, SlotApproval, SettleToTakerParams} from "../../src/PositionAccount.sol";
import {Economics} from "optioncore/types/Economics.sol";
import {Pointers} from "optioncore/types/Pointers.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockPriceOracle} from "./mocks/MockPriceOracle.sol";

contract MockPositionManager {
    mapping(uint256 => address) public ownerOf;

    function setOwner(uint256 id, address owner) external {
        ownerOf[id] = owner;
    }
}

contract MockSettlementVenue {
    uint256 public rateNumerator = 3500e6;
    uint256 public rateDenominator = 1e18;

    function setRate(uint256 num, uint256 den) external {
        rateNumerator = num;
        rateDenominator = den;
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256,
        uint256,
        bytes32
    ) external returns (uint256 amountOut) {
        TestERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        amountOut = (amountIn * rateNumerator) / rateDenominator;
        TestERC20(tokenOut).transfer(msg.sender, amountOut);
    }
}

contract SettlementAccountingTest is Test {
    PositionAccount implementation;
    PositionAccount account;
    MockPositionManager pm;
    MockSettlementVenue venue;
    MockPriceOracle oracle;
    MockPriceOracle btcOracle;
    TestERC20 weth;
    TestERC20 wbtc;
    TestERC20 usdc;

    address lp = makeAddr("lp");
    address taker = makeAddr("taker");
    address feeVault = makeAddr("feeVault");
    address arbiter = makeAddr("arbiter");
    address condition = makeAddr("condition");

    function setUp() public {
        weth = new TestERC20("Wrapped Ether", "WETH", 18);
        wbtc = new TestERC20("Wrapped Bitcoin", "WBTC", 8);
        usdc = new TestERC20("USD Coin", "USDC", 6);
        pm = new MockPositionManager();
        venue = new MockSettlementVenue();
        oracle = new MockPriceOracle(address(weth), address(usdc), 3000e18, 18, "WETH/USDC");
        btcOracle = new MockPriceOracle(address(wbtc), address(usdc), 60000e18, 18, "WBTC/USDC");

        implementation = new PositionAccount(address(0), feeVault);
        account = implementation; // test directly first

        // Fund venue with USDC for swaps
        usdc.mint(address(venue), 10_000_000e6);
    }

    function test_settle_call_option() public {
        // 0.1 WETH collateral = 1e17
        weth.mint(address(account), 1e17);
        account.recordMint(1e17, 0);

        uint256 positionId = 1;
        pm.setOwner(positionId, taker);

        // Price goes to 3500
        oracle.setPrice(3500e18, block.timestamp);

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(weth),
            collateralDecimals: 18,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 0, // CALL
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 3000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(oracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        bytes memory params = abi.encode(SettleToTakerParams({
            exitPrice: 3500e18,
            minAmountOut: 0,
            minPayoutToTaker: 0,
            swapDeadline: block.timestamp + 3600
        }));

        ActionContext memory ctx = ActionContext({
            account: address(account),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: positionId,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToTaker,
            params: params,
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        account.settleToTaker(ctx, approvals);

        // Check balances
        // Taker should get: gross payout ($50 USDC) - 1% fee ($0.50 USDC) = $49.50 USDC = 49_500_000
        assertApproxEqAbs(usdc.balanceOf(taker), 49_500_000, 1, "Taker payout mismatch");
        // FeeVault should get: $0.50 USDC = 500_000
        assertEq(usdc.balanceOf(feeVault), 500_000, "FeeVault fee mismatch");
        // LP should get remainder collateral
        assertGt(weth.balanceOf(lp), 0.08e18, "LP remainder too low");
    }

    function test_settle_put_option() public {
        // Deploy fresh account for PUT
        PositionAccount putAccount = new PositionAccount(address(0), feeVault);
        // Mint 300 USDC collateral for 0.1 WETH at $3,000
        usdc.mint(address(putAccount), 300e6);
        putAccount.recordMint(0, 300e6);

        uint256 positionId = 2;
        pm.setOwner(positionId, taker);

        // Price drops to 2500
        oracle.setPrice(2500e18, block.timestamp);

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(weth),
            collateralDecimals: 18,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 1, // PUT
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 3000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(oracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        bytes memory params = abi.encode(SettleToTakerParams({
            exitPrice: 2500e18,
            minAmountOut: 0,
            minPayoutToTaker: 0,
            swapDeadline: block.timestamp + 3600
        }));

        ActionContext memory ctx = ActionContext({
            account: address(putAccount),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: positionId,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToTaker,
            params: params,
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        uint256 takerBefore = usdc.balanceOf(taker);
        uint256 lpBefore = usdc.balanceOf(lp);
        uint256 feeBefore = usdc.balanceOf(feeVault);

        putAccount.settleToTaker(ctx, approvals);

        // Taker profit: $50 gross - $0.50 fee = $49.50 USDC = 49_500_000
        assertEq(usdc.balanceOf(taker) - takerBefore, 49_500_000, "PUT Taker payout mismatch");
        assertEq(usdc.balanceOf(feeVault) - feeBefore, 500_000, "PUT fee mismatch");
        // LP recovery: $300 - $50 = $250 USDC = 250_000_000
        assertEq(usdc.balanceOf(lp) - lpBefore, 250_000_000, "PUT LP recovery mismatch");
    }

    function test_settle_expired_call_to_lp() public {
        PositionAccount expAccount = new PositionAccount(address(0), feeVault);
        weth.mint(address(expAccount), 1e17);
        expAccount.recordMint(1e17, 0);

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(weth),
            collateralDecimals: 18,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 0, // CALL
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 3000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(oracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        ActionContext memory ctx = ActionContext({
            account: address(expAccount),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: 3,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToLp,
            params: "",
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        uint256 lpWethBefore = weth.balanceOf(lp);
        expAccount.settleToLp(ctx, approvals);

        // LP recovers 100% of collateral
        assertEq(weth.balanceOf(lp) - lpWethBefore, 1e17, "Expired recovery mismatch");
    }

    function test_settle_wbtc_call_option() public {
        PositionAccount btcAccount = new PositionAccount(address(0), feeVault);
        // 0.10 WBTC collateral = 0.1 * 1e8 = 10_000_000 satoshis
        wbtc.mint(address(btcAccount), 10_000_000);
        btcAccount.recordMint(10_000_000, 0);

        uint256 positionId = 4;
        pm.setOwner(positionId, taker);

        // Price rises from $60,000 to $70,000
        btcOracle.setPrice(70000e18, block.timestamp);
        venue.setRate(70000e6, 1e8); // Rate: 70,000 USDC (6 dec) per 1 WBTC (8 dec)

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(wbtc),
            collateralDecimals: 8,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 0, // CALL
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 60000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(btcOracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        bytes memory params = abi.encode(SettleToTakerParams({
            exitPrice: 70000e18,
            minAmountOut: 0,
            minPayoutToTaker: 0,
            swapDeadline: block.timestamp + 3600
        }));

        ActionContext memory ctx = ActionContext({
            account: address(btcAccount),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: positionId,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToTaker,
            params: params,
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        uint256 takerUsdcBefore = usdc.balanceOf(taker);
        uint256 feeBefore = usdc.balanceOf(feeVault);
        uint256 lpWbtcBefore = wbtc.balanceOf(lp);

        btcAccount.settleToTaker(ctx, approvals);

        // Gross PnL: ($70,000 - $60,000) * 0.10 = $1,000 USDC
        // Fee (1%): $10 USDC = 10_000_000
        // Net Taker Payout: $990 USDC = 990_000_000 (allow satoshi truncation delta of <= 1000 wei / $0.001)
        assertApproxEqAbs(usdc.balanceOf(taker) - takerUsdcBefore, 990_000_000, 1000, "WBTC Taker payout mismatch");
        assertEq(usdc.balanceOf(feeVault) - feeBefore, 10_000_000, "WBTC Fee mismatch");

        // Remainder WBTC to LP:
        // Collateral sold = ($1,000 / $70,000) * 1e8 = 1,428,571 satoshis = 0.01428571 WBTC
        // Remainder = 10,000,000 - 1,428,571 = 8,571,429 satoshis = ~0.08571429 WBTC
        assertApproxEqAbs(wbtc.balanceOf(lp) - lpWbtcBefore, 8_571_429, 2, "WBTC LP remainder mismatch");
    }

    function test_settle_wbtc_put_option() public {
        PositionAccount btcPutAccount = new PositionAccount(address(0), feeVault);
        // Mint 6,000 USDC collateral for 0.10 WBTC at $60,000 strike
        usdc.mint(address(btcPutAccount), 6000e6);
        btcPutAccount.recordMint(0, 6000e6);

        uint256 positionId = 5;
        pm.setOwner(positionId, taker);

        // Price drops from $60,000 to $50,000 (-$10,000)
        btcOracle.setPrice(50000e18, block.timestamp);

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(wbtc),
            collateralDecimals: 8,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 1, // PUT
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 60000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(btcOracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        bytes memory params = abi.encode(SettleToTakerParams({
            exitPrice: 50000e18,
            minAmountOut: 0,
            minPayoutToTaker: 0,
            swapDeadline: block.timestamp + 3600
        }));

        ActionContext memory ctx = ActionContext({
            account: address(btcPutAccount),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: positionId,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToTaker,
            params: params,
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        uint256 takerBefore = usdc.balanceOf(taker);
        uint256 feeBefore = usdc.balanceOf(feeVault);
        uint256 lpBefore = usdc.balanceOf(lp);

        btcPutAccount.settleToTaker(ctx, approvals);

        // Gross PnL: ($60,000 - $50,000) * 0.10 = $1,000 USDC
        // Fee: $10 USDC
        // Taker: $990 USDC
        assertEq(usdc.balanceOf(taker) - takerBefore, 990_000_000, "WBTC PUT Taker payout mismatch");
        assertEq(usdc.balanceOf(feeVault) - feeBefore, 10_000_000, "WBTC PUT Fee mismatch");
        // LP Remainder: $6,000 - $1,000 = $5,000 USDC
        assertEq(usdc.balanceOf(lp) - lpBefore, 5000_000_000, "WBTC PUT LP recovery mismatch");
    }

    function test_unprofitable_call_reverts() public {
        PositionAccount otmAccount = new PositionAccount(address(0), feeVault);
        weth.mint(address(otmAccount), 1e17);
        otmAccount.recordMint(1e17, 0);

        pm.setOwner(6, taker);

        // Spot price drops to 2500 for a 3000 strike CALL (unprofitable)
        oracle.setPrice(2500e18, block.timestamp);

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(weth),
            collateralDecimals: 18,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 0, // CALL
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 3000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(oracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        ActionContext memory ctx = ActionContext({
            account: address(otmAccount),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: 6,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToTaker,
            params: "",
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        // Expect revert UnprofitablePosition()
        vm.expectRevert(PositionAccount.UnprofitablePosition.selector);
        otmAccount.settleToTaker(ctx, approvals);
    }

    function test_unprofitable_put_reverts() public {
        PositionAccount otmPutAccount = new PositionAccount(address(0), feeVault);
        usdc.mint(address(otmPutAccount), 300e6);
        otmPutAccount.recordMint(0, 300e6);

        pm.setOwner(7, taker);

        // Spot price rises to 3500 for a 3000 strike PUT (unprofitable)
        oracle.setPrice(3500e18, block.timestamp);

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(weth),
            collateralDecimals: 18,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 1, // PUT
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 3000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(oracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        ActionContext memory ctx = ActionContext({
            account: address(otmPutAccount),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: 7,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToTaker,
            params: "",
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        // Expect revert UnprofitablePosition()
        vm.expectRevert(PositionAccount.UnprofitablePosition.selector);
        otmPutAccount.settleToTaker(ctx, approvals);
    }

    function test_already_settled_reverts() public {
        PositionAccount expAccount = new PositionAccount(address(0), feeVault);
        weth.mint(address(expAccount), 1e17);
        expAccount.recordMint(1e17, 0);

        Economics memory econ = Economics({
            lp: lp,
            collateralAsset: address(weth),
            collateralDecimals: 18,
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            optionType: 0, // CALL
            units: 10,
            unitScalarNum: 1,
            unitScalarDen: 100,
            entryPrice: 3000e18,
            expiry: uint64(block.timestamp + 86400),
            feeBps: 100
        });

        Pointers memory ptrs = Pointers({
            oracle: address(oracle),
            venue: address(venue),
            arbiter: arbiter,
            condition: condition,
            routeId: bytes32(0),
            maxPriceAge: 86400,
            slippageBps: 100
        });

        ActionContext memory ctx = ActionContext({
            account: address(expAccount),
            implementation: address(implementation),
            homeChainId: block.chainid,
            positionManager: address(pm),
            positionId: 8,
            accountState: 0,
            signerEpoch: 0,
            actionKind: ActionKind.SettleToLp,
            params: "",
            deadline: block.timestamp + 3600,
            economics: econ,
            pointers: ptrs
        });

        SlotApproval[] memory approvals = new SlotApproval[](0);

        expAccount.settleToLp(ctx, approvals);

        // Second settle must revert AlreadySettled()
        vm.expectRevert(PositionAccount.AlreadySettled.selector);
        expAccount.settleToLp(ctx, approvals);
    }
}
