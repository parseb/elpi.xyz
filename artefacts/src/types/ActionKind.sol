// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

enum ActionKind {
    SettleToTaker,
    SettleToLp,
    MutualUnwind,
    SweepDust,
    RawExecute
}
