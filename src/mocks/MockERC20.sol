// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Mintable test ERC-20 for devnet and local testing.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Free minting for testing and funding personas.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Convenient faucet for caller to obtain tokens.
    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    /// @notice Burn capability for testing balance reductions.
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
