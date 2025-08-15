// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../LookCoin.sol";

/**
 * @title SimpleUpgradeTarget
 * @dev Minimal upgrade target for testing UUPS upgrade functionality
 * 
 * This contract provides the minimum required upgrade testing features
 * while staying under the 24KB contract size limit.
 */
contract SimpleUpgradeTarget is LookCoin {
    // Version information
    string public constant VERSION = "2.0.0";
    
    // Minimal upgrade state
    bool public isUpgraded;
    bool public newFeatureEnabled;
    
    // Storage gap to accommodate new variables
    uint256[46] private __gapV2;
    
    event UpgradeCompleted(string version);
    
    /**
     * @dev Initialize V2 features
     */
    function initializeV2() external onlyRole(UPGRADER_ROLE) {
        require(!isUpgraded, "Already initialized");
        isUpgraded = true;
        emit UpgradeCompleted(VERSION);
    }
    
    /**
     * @dev Get contract version
     */
    function getVersion() external pure returns (string memory) {
        return VERSION;
    }
    
    /**
     * @dev Enable or disable new V2 features
     */
    function setNewFeatureEnabled(bool enabled) external onlyRole(PROTOCOL_ADMIN_ROLE) {
        newFeatureEnabled = enabled;
    }
}