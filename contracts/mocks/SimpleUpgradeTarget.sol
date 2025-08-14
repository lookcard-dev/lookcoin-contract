// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../LookCoin.sol";

/**
 * @title SimpleUpgradeTarget
 * @dev Minimal upgrade target for testing basic upgrade functionality
 * 
 * This contract provides the absolute minimum required for upgrade testing
 * while staying well under the 24KB contract size limit.
 */
contract SimpleUpgradeTarget is LookCoin {
    // Version information
    string public constant VERSION = "2.0.0";
    
    // Simple upgrade flag
    bool public isUpgraded;
    
    // Storage gap (slightly reduced)
    uint256[47] private __gapV2;
    
    event UpgradeCompleted(string version, address indexed upgrader);
    
    /**
     * @dev Initialize V2 features
     */
    function initializeV2() external onlyRole(UPGRADER_ROLE) {
        require(!isUpgraded, "SimpleUpgradeTarget: already initialized");
        isUpgraded = true;
        emit UpgradeCompleted(VERSION, msg.sender);
    }
    
    /**
     * @dev Get contract version
     */
    function getVersion() external pure returns (string memory) {
        return VERSION;
    }
    
    /**
     * @dev Test function for upgrade scenarios
     */
    function testUpgradeFailure(bool shouldFail) external pure {
        if (shouldFail) {
            revert("SimpleUpgradeTarget: intentional failure");
        }
    }
}