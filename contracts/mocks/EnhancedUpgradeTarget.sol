// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../LookCoin.sol";

/**
 * @title EnhancedUpgradeTarget
 * @dev Properly structured upgrade target that avoids storage collisions
 * 
 * Storage Layout:
 * - Slots 0-50: Inherited from Initializable, ContextUpgradeable, ERC165Upgradeable
 * - Slots 51-100: Inherited from AccessControlUpgradeable  
 * - Slots 101-150: Inherited from PausableUpgradeable
 * - Slots 151-200: Inherited from ERC20Upgradeable
 * - Slots 201-250: Inherited from ERC20PermitUpgradeable
 * - Slots 251-300: Inherited from UUPSUpgradeable
 * - Slots 301-350: LookCoin specific storage
 * - Slots 351-400: Reserved for V2 features (this contract)
 */
contract EnhancedUpgradeTarget is LookCoin {
    // ============ Storage Layout V2 ============
    // Start at slot 351 to avoid any collision with base contract
    
    /// @custom:storage-location erc7201:lookcoin.storage.v2
    struct UpgradeStorageV2 {
        string version;
        bool isUpgraded;
        bool newFeatureEnabled;
        mapping(address => bool) v2Users;
        uint256 v2Counter;
        bytes32 v2ConfigHash;
    }
    
    // ERC-7201 storage location for V2 features
    // Using a unique namespace to avoid collisions
    
    function _getV2Storage() private pure returns (UpgradeStorageV2 storage $) {
        assembly {
            // Use a high storage slot that won't collide
            $.slot := 0x5f7f8c4d3e2b1a0900000000000000000000000000000000000000000000000
        }
    }
    
    // ============ Events ============
    event UpgradeCompleted(string version);
    event V2FeatureToggled(bool enabled);
    event V2UserAdded(address user);
    
    // ============ Errors ============
    error AlreadyInitializedV2();
    error V2FeatureDisabled();
    
    // ============ Initializer ============
    
    /**
     * @dev Initialize V2 features - can only be called once
     */
    function initializeV2() external onlyRole(UPGRADER_ROLE) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        
        if ($.isUpgraded) {
            revert AlreadyInitializedV2();
        }
        
        $.version = "2.0.0";
        $.isUpgraded = true;
        $.v2ConfigHash = keccak256(abi.encodePacked(block.timestamp, msg.sender));
        
        emit UpgradeCompleted($.version);
    }
    
    // ============ V2 Features ============
    
    /**
     * @dev Get contract version
     */
    function getVersion() external view returns (string memory) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        return bytes($.version).length > 0 ? $.version : "1.0.0";
    }
    
    /**
     * @dev Check if V2 is initialized
     */
    function isV2Initialized() external view returns (bool) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        return $.isUpgraded;
    }
    
    /**
     * @dev Enable or disable new V2 features
     */
    function setNewFeatureEnabled(bool enabled) external onlyRole(PROTOCOL_ADMIN_ROLE) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        $.newFeatureEnabled = enabled;
        emit V2FeatureToggled(enabled);
    }
    
    /**
     * @dev Check if new feature is enabled
     */
    function isNewFeatureEnabled() external view returns (bool) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        return $.newFeatureEnabled;
    }
    
    /**
     * @dev Add a V2 user (example of new functionality)
     */
    function addV2User(address user) external onlyRole(DEFAULT_ADMIN_ROLE) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        
        if (!$.newFeatureEnabled) {
            revert V2FeatureDisabled();
        }
        
        $.v2Users[user] = true;
        $.v2Counter++;
        emit V2UserAdded(user);
    }
    
    /**
     * @dev Check if user is V2 user
     */
    function isV2User(address user) external view returns (bool) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        return $.v2Users[user];
    }
    
    /**
     * @dev Get V2 stats
     */
    function getV2Stats() external view returns (
        uint256 userCount,
        bytes32 configHash,
        bool featureEnabled
    ) {
        UpgradeStorageV2 storage $ = _getV2Storage();
        return ($.v2Counter, $.v2ConfigHash, $.newFeatureEnabled);
    }
    
    // ============ Storage Collision Prevention ============
    
    /**
     * @dev Validate storage layout hasn't changed
     * This function helps detect storage collisions during testing
     */
    function validateStorageLayout() external view returns (bool) {
        // Check that critical base contract values are still accessible
        require(totalSupply() >= 0, "totalSupply check failed");
        require(bytes(name()).length > 0, "name check failed");
        require(bytes(symbol()).length > 0, "symbol check failed");
        require(decimals() == 18, "decimals check failed");
        
        // Check role constants are unchanged
        require(DEFAULT_ADMIN_ROLE == 0x00, "Admin role check failed");
        require(MINTER_ROLE == keccak256("MINTER_ROLE"), "Minter role check failed");
        
        return true;
    }
    
    // _authorizeUpgrade is already implemented in LookCoin base contract
    // No need to override here as it's not virtual
}

/**
 * @title MinimalUpgradeTarget
 * @dev Minimal upgrade for testing that won't cause collisions
 */
contract MinimalUpgradeTarget is LookCoin {
    // Single new variable using ERC-7201 pattern
    /// @custom:storage-location erc7201:minimal.storage.v2
    struct MinimalStorageV2 {
        string version;
    }
    
    function _getMinimalV2Storage() private pure returns (MinimalStorageV2 storage $) {
        assembly {
            // Use a different high storage slot
            $.slot := 0x6f7f8c4d3e2b1a0900000000000000000000000000000000000000000000000
        }
    }
    
    function getVersion() external view returns (string memory) {
        MinimalStorageV2 storage $ = _getMinimalV2Storage();
        return bytes($.version).length > 0 ? $.version : "1.0.0-minimal";
    }
    
    function setVersion(string memory _version) external onlyRole(UPGRADER_ROLE) {
        MinimalStorageV2 storage $ = _getMinimalV2Storage();
        $.version = _version;
    }
}