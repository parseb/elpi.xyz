// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ERC6551AccountLib} from "erc6551-reference/lib/ERC6551AccountLib.sol";
import {ILPSettlementHook} from "./interfaces/ILPSettlementHook.sol";
import {ISettlementVenue} from "./interfaces/ISettlementVenue.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {Economics} from "optioncore/types/Economics.sol";
import {Pointers} from "optioncore/types/Pointers.sol";
import {IPositionAccountMintHooks} from "optioncore/interfaces/IPositionAccountMintHooks.sol";

enum ActionKind {
    SettleToTaker,
    SettleToLp,
    MutualUnwind,
    SweepDust,
    RawExecute
}

struct SlotApproval {
    uint8 slot;
    bytes signature;
}

struct ActionContext {
    address account;
    address implementation;
    uint256 homeChainId;
    address positionManager;
    uint256 positionId;
    uint256 accountState;
    uint256 signerEpoch;
    ActionKind actionKind;
    bytes params;
    uint256 deadline;
    Economics economics;
    Pointers pointers;
}

struct SettleToTakerParams {
    uint256 exitPrice;
    uint256 minAmountOut;
    uint256 minPayoutToTaker;
    uint256 swapDeadline;
}

struct Realized {
    uint256 recordedCollateral;
    uint256 recordedSettlement;
}

/// @title PositionAccount
/// @notice Token-bound account (ERC-6551) holding collateral for an option position.
///         Executes payouts, settlement, and automatic restaking back into Uniswap v4.
contract PositionAccount is IPositionAccountMintHooks, IERC721Receiver, IERC1155Receiver {
    using SafeERC20 for IERC20;

    bytes4 private constant ERC6551_VALID_SIGNER = 0x523e3260;

    address public immutable authzModule;
    address public immutable feeVault;

    Realized public realized;
    uint256 public accountState;
    mapping(bytes32 => uint256) public rawExecutePendingSince;

    error OnlyPositionManager();
    error AlreadyRecorded();
    error AlreadySettled();
    error UnprofitablePosition();
    error PayoutBelowMinimum(uint256 payout, uint256 minPayoutToTaker);

    constructor(address authzModule_, address feeVault_) {
        authzModule = authzModule_;
        feeVault = feeVault_;
    }

    receive() external payable {}

    function recordMint(uint256 recordedCollateral, uint256 recordedSettlement) external override {
        realized = Realized(recordedCollateral, recordedSettlement);
    }

    function initialSwapAndRecord(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId,
        address venue
    ) external override {
        IERC20(tokenIn).forceApprove(venue, amountIn);
        uint256 out = ISettlementVenue(venue).swap(tokenIn, tokenOut, amountIn, minAmountOut, deadline, routeId);
        realized = Realized(0, out);
    }

    function token() public view returns (uint256, address, uint256) {
        return ERC6551AccountLib.token();
    }

    function state() external view returns (uint256) {
        return accountState;
    }

    function isValidSigner(address, bytes calldata) external pure returns (bytes4) {
        return ERC6551_VALID_SIGNER;
    }

    function settleToTaker(ActionContext calldata ctx, SlotApproval[] calldata) external {
        if (accountState > 0) revert AlreadySettled();
        accountState++;

        SettleToTakerParams memory p;
        if (ctx.params.length >= 128) {
            p = abi.decode(ctx.params, (SettleToTakerParams));
        }

        (uint256 livePrice,) = IPriceOracle(ctx.pointers.oracle).price(ctx.economics.collateralAsset, ctx.economics.settlementAsset);
        bool isCall = ctx.economics.optionType == 0;
        int256 signedPnl = isCall
            ? int256(livePrice) - int256(ctx.economics.entryPrice)
            : int256(ctx.economics.entryPrice) - int256(livePrice);
        if (signedPnl <= 0) revert UnprofitablePosition();
        uint256 pnl = uint256(signedPnl);

        address taker = IERC721(ctx.positionManager).ownerOf(ctx.positionId);
        uint256 fee;
        uint256 payout;

        if (isCall) {
            // CALL settlement
            uint256 heldCollateral = realized.recordedCollateral > 0
                ? realized.recordedCollateral
                : IERC20(ctx.economics.collateralAsset).balanceOf(address(this));

            uint256 grossPayout = (pnl * ctx.economics.units * (10 ** ctx.economics.settlementDecimals)) / (1e18 * ctx.economics.unitScalarDen / ctx.economics.unitScalarNum);
            fee = (grossPayout * ctx.economics.feeBps + 9999) / 10000;
            payout = grossPayout > fee ? grossPayout - fee : 0;

            uint256 collateralForPayout = (pnl * ctx.economics.units * ctx.economics.unitScalarNum * (10 ** ctx.economics.collateralDecimals)) / (livePrice * ctx.economics.unitScalarDen);
            if (collateralForPayout > heldCollateral) collateralForPayout = heldCollateral;
            uint256 remainderCollateral = heldCollateral - collateralForPayout;

            // Swap collateral to settlement asset via venue
            if (collateralForPayout > 0 && ctx.pointers.venue != address(0)) {
                IERC20(ctx.economics.collateralAsset).forceApprove(ctx.pointers.venue, collateralForPayout);
                try ISettlementVenue(ctx.pointers.venue).swap(
                    ctx.economics.collateralAsset,
                    ctx.economics.settlementAsset,
                    collateralForPayout,
                    p.minAmountOut,
                    block.timestamp + 300,
                    ctx.pointers.routeId
                ) returns (uint256 swappedOut) {
                    if (swappedOut < payout + fee) {
                        payout = swappedOut > fee ? swappedOut - fee : 0;
                    }
                    IERC20(ctx.economics.settlementAsset).safeTransfer(taker, payout);
                    if (fee > 0) IERC20(ctx.economics.settlementAsset).safeTransfer(feeVault, fee);
                } catch {
                    // In-Kind Fallback: transfer collateral directly
                    uint256 inKindFee = (collateralForPayout * ctx.economics.feeBps + 9999) / 10000;
                    uint256 inKindPayout = collateralForPayout - inKindFee;
                    IERC20(ctx.economics.collateralAsset).safeTransfer(taker, inKindPayout);
                    if (inKindFee > 0) IERC20(ctx.economics.collateralAsset).safeTransfer(feeVault, inKindFee);
                }
            }

            // Return remainder collateral to LP (V4LiquidityVault)
            if (remainderCollateral > 0) {
                IERC20(ctx.economics.collateralAsset).safeTransfer(ctx.economics.lp, remainderCollateral);
                if (ctx.economics.lp.code.length > 0) {
                    try ILPSettlementHook(ctx.economics.lp).onPositionSettled(ctx.positionId, ctx.economics.collateralAsset, remainderCollateral) {} catch {}
                }
            }
        } else {
            // PUT settlement
            uint256 heldSettlement = realized.recordedSettlement > 0
                ? realized.recordedSettlement
                : IERC20(ctx.economics.settlementAsset).balanceOf(address(this));

            uint256 grossPayout = (pnl * ctx.economics.units * (10 ** ctx.economics.settlementDecimals)) / (1e18 * ctx.economics.unitScalarDen / ctx.economics.unitScalarNum);
            fee = (grossPayout * ctx.economics.feeBps + 9999) / 10000;
            payout = grossPayout > fee ? grossPayout - fee : 0;
            uint256 totalDeduction = payout + fee;
            if (totalDeduction > heldSettlement) {
                payout = heldSettlement > fee ? heldSettlement - fee : 0;
                totalDeduction = heldSettlement;
            }
            uint256 remainderSettlement = heldSettlement - totalDeduction;

            if (payout > 0) IERC20(ctx.economics.settlementAsset).safeTransfer(taker, payout);
            if (fee > 0) IERC20(ctx.economics.settlementAsset).safeTransfer(feeVault, fee);

            if (remainderSettlement > 0) {
                IERC20(ctx.economics.settlementAsset).safeTransfer(ctx.economics.lp, remainderSettlement);
                if (ctx.economics.lp.code.length > 0) {
                    try ILPSettlementHook(ctx.economics.lp).onPositionSettled(ctx.positionId, ctx.economics.settlementAsset, remainderSettlement) {} catch {}
                }
            }
        }
    }

    function settleToLp(ActionContext calldata ctx, SlotApproval[] calldata) external {
        if (accountState > 0) revert AlreadySettled();
        accountState++;

        address asset = ctx.economics.optionType == 0 ? ctx.economics.collateralAsset : ctx.economics.settlementAsset;
        uint256 bal = IERC20(asset).balanceOf(address(this));
        if (bal > 0) {
            IERC20(asset).safeTransfer(ctx.economics.lp, bal);
            if (ctx.economics.lp.code.length > 0) {
                try ILPSettlementHook(ctx.economics.lp).onPositionSettled(ctx.positionId, asset, bal) {} catch {}
            }
        }
    }

    function mutualUnwind(ActionContext calldata ctx, SlotApproval[] calldata) external {
        if (accountState > 0) revert AlreadySettled();
        accountState++;

        address asset = ctx.economics.optionType == 0 ? ctx.economics.collateralAsset : ctx.economics.settlementAsset;
        uint256 bal = IERC20(asset).balanceOf(address(this));
        if (bal > 0) {
            IERC20(asset).safeTransfer(ctx.economics.lp, bal);
            if (ctx.economics.lp.code.length > 0) {
                try ILPSettlementHook(ctx.economics.lp).onPositionSettled(ctx.positionId, asset, bal) {} catch {}
            }
        }
    }

    function sweepDust(ActionContext calldata, SlotApproval[] calldata) external pure {}

    function rawExecute(ActionContext calldata, SlotApproval[] calldata) external pure {}

    function execute(address, uint256, bytes calldata, uint8) external payable returns (bytes memory) {
        return "";
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x6e788730 // ERC-6551 Account
            || interfaceId == 0x51945447 // ERC-6551 Executable
            || interfaceId == 0x150b7a02 // ERC-721 Receiver
            || interfaceId == 0x4e2312e0; // ERC-1155 Receiver
    }
}
