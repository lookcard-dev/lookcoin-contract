// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IXERC20Factory {
    function deployXERC20(
        string memory name,
        string memory symbol,
        uint256 mintingLimit,
        uint256 burningLimit,
        address[] calldata bridges,
        uint256[] calldata mintingLimits,
        uint256[] calldata burningLimits
    ) external returns (address);
}