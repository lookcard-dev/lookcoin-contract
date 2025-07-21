// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IXERC20 is IERC20 {
    event BridgeLimitsSet(address indexed bridge, uint256 mintingLimit, uint256 burningLimit);
    event BridgeRegistered(address indexed bridge);
    event BridgeRemoved(address indexed bridge);

    function mint(address account, uint256 amount) external;
    function burn(address account, uint256 amount) external;
    function setLimits(address bridge, uint256 mintingLimit, uint256 burningLimit) external;
    function mintingCurrentLimitOf(address bridge) external view returns (uint256);
    function burningCurrentLimitOf(address bridge) external view returns (uint256);
    function mintingMaxLimitOf(address bridge) external view returns (uint256);
    function burningMaxLimitOf(address bridge) external view returns (uint256);
}