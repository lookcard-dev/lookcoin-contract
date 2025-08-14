// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../LookCoin.sol";

/**
 * @title MockUpgradeTarget
 * @dev Mock upgraded version of LookCoin for testing upgrade scenarios
 * 
 * This contract simulates LookCoin V2 with additional features for testing:
 * - Backward compatibility with V1 functionality
 * - New features and state variables
 * - Version tracking and feature flags
 * - Storage layout compatibility testing
 * - Emergency upgrade capabilities
 * 
 * Key Features:
 * - All LookCoin V1 functionality preserved
 * - Additional upgrade-specific test functions
 * - Version management and feature flags
 * - Enhanced security features for testing
 * - Cross-chain upgrade compatibility
 * 
 * Testing Focus:
 * - Validate state preservation during upgrades
 * - Test new functionality activation
 * - Verify storage layout compatibility
 * - Test emergency upgrade scenarios
 * - Validate cross-version compatibility
 */
contract MockUpgradeTarget is LookCoin {
    // Version information
    string public constant VERSION = "2.0.0";
    uint256 public constant UPGRADE_TIMESTAMP = 1699920000; // Mock upgrade timestamp
    
    // New state variables for V2 (these affect storage layout)
    /// @dev Flag indicating if contract has been upgraded
    bool public isUpgraded;
    
    /// @dev New feature toggle for testing
    bool public newFeatureEnabled;
    
    /// @dev Enhanced pause reason for better debugging
    string public pauseReason;
    
    /// @dev Upgrade history tracking
    mapping(uint256 => address) public upgradeHistory;
    uint256 public upgradeCount;
    
    /// @dev Enhanced cross-chain configuration
    mapping(uint16 => uint256) public enhancedChainLimits;
    mapping(uint16 => bool) public chainEmergencyMode;
    
    /// @dev Advanced supply tracking for V2
    uint256 public totalBridgedIn;
    uint256 public totalBridgedOut;
    mapping(address => uint256) public userBridgeVolume;
    
    // Storage gap reduced due to new variables (original was 48)
    uint256[35] private __gapV2;
    
    // V2 Events
    event UpgradeCompleted(string version, uint256 timestamp, address indexed upgrader);
    event NewFeatureActivated(string feature, bool enabled, address indexed activator);
    event EnhancedPauseActivated(string reason, address indexed pauser);
    event BridgeVolumeUpdated(address indexed user, uint256 volume, uint16 chainId);
    event EmergencyModeActivated(uint16 indexed chainId, bool enabled);
    
    // V2 Custom Errors
    error UpgradeNotInitialized();
    error NewFeatureNotEnabled();
    error InvalidUpgradeTarget();
    error EmergencyModeActive();
    
    /**
     * @dev Initialize V2 features (called during upgrade if needed)
     * @notice This function can be called during upgradeToAndCall
     */
    function initializeV2() external onlyRole(UPGRADER_ROLE) {
        require(!isUpgraded, "MockUpgradeTarget: already initialized");
        
        isUpgraded = true;
        newFeatureEnabled = false;
        pauseReason = "";
        upgradeCount = 1;
        upgradeHistory[0] = address(this);
        
        emit UpgradeCompleted(VERSION, UPGRADE_TIMESTAMP, msg.sender);
    }
    
    /**
     * @dev Get contract version
     * @return version Current contract version string
     */
    function getVersion() external pure returns (string memory version) {
        return VERSION;
    }
    
    /**
     * @dev Check if specific V2 feature is available
     * @param featureName Name of the feature to check
     * @return available True if feature is available
     */
    function isFeatureAvailable(string calldata featureName) external view returns (bool available) {
        bytes32 featureHash = keccak256(abi.encodePacked(featureName));
        
        if (featureHash == keccak256("enhanced_pause")) {
            return isUpgraded;
        } else if (featureHash == keccak256("bridge_volume_tracking")) {
            return isUpgraded && newFeatureEnabled;
        } else if (featureHash == keccak256("emergency_chain_mode")) {
            return isUpgraded;
        }
        
        return false;
    }
    
    /**
     * @dev Enhanced pause function with reason (V2 feature)
     * @param reason Reason for pausing the contract
     */
    function pauseWithReason(string calldata reason) external onlyRole(PAUSER_ROLE) {
        if (!isUpgraded) revert UpgradeNotInitialized();
        
        pauseReason = reason;
        _pause();
        
        emit EnhancedPauseActivated(reason, msg.sender);
    }
    
    /**
     * @dev Enhanced unpause function that clears reason
     */
    function unpauseWithClear() external onlyRole(PAUSER_ROLE) {
        pauseReason = "";
        _unpause();
    }
    
    /**
     * @dev Toggle new feature (V2 functionality)
     * @param enabled Whether to enable the new feature
     */
    function setNewFeatureEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isUpgraded) revert UpgradeNotInitialized();
        
        newFeatureEnabled = enabled;
        emit NewFeatureActivated("bridge_volume_tracking", enabled, msg.sender);
    }
    
    /**
     * @dev Enhanced mint function with volume tracking (V2 feature)
     * @param to Address to mint tokens to
     * @param amount Amount to mint
     * @param trackVolume Whether to track this as bridge volume
     */
    function enhancedMint(
        address to, 
        uint256 amount, 
        bool trackVolume
    ) external whenNotPaused nonReentrant supplyInvariant {
        require(hasRole(MINTER_ROLE, msg.sender) || hasRole(BRIDGE_ROLE, msg.sender), "MockUpgradeTarget: unauthorized minter");
        
        if (trackVolume && newFeatureEnabled) {
            totalBridgedIn += amount;
            userBridgeVolume[to] += amount;
        }
        
        // Call parent mint functionality
        totalMinted += amount;
        _mint(to, amount);
        
        if (trackVolume && newFeatureEnabled) {
            emit BridgeVolumeUpdated(to, userBridgeVolume[to], 0); // 0 indicates mint operation
        }
    }
    
    /**
     * @dev Enhanced burn function with volume tracking (V2 feature)
     * @param from Address to burn tokens from
     * @param amount Amount to burn
     * @param trackVolume Whether to track this as bridge volume
     */
    function enhancedBurn(
        address from, 
        uint256 amount, 
        bool trackVolume
    ) external whenNotPaused nonReentrant supplyInvariant {
        require(hasRole(BURNER_ROLE, msg.sender) || hasRole(BRIDGE_ROLE, msg.sender), "MockUpgradeTarget: unauthorized burner");
        
        if (trackVolume && newFeatureEnabled) {
            totalBridgedOut += amount;
            userBridgeVolume[from] += amount;
        }
        
        // Call parent burn functionality
        totalBurned += amount;
        _burn(from, amount);
        
        if (trackVolume && newFeatureEnabled) {
            emit BridgeVolumeUpdated(from, userBridgeVolume[from], 0); // 0 indicates burn operation
        }
    }
    
    /**
     * @dev Set emergency mode for specific chain (V2 feature)
     * @param chainId Chain ID to set emergency mode for
     * @param enabled Whether emergency mode is enabled
     */
    function setChainEmergencyMode(uint16 chainId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isUpgraded) revert UpgradeNotInitialized();
        
        chainEmergencyMode[chainId] = enabled;
        emit EmergencyModeActivated(chainId, enabled);
    }
    
    /**
     * @dev Enhanced cross-chain transfer with emergency mode check (V2 feature)
     * @param from Sender address
     * @param dstChainId Destination chain ID
     * @param toAddress Recipient address (encoded)
     * @param amount Amount to transfer
     * @param refundAddress Refund address
     * @param zroPaymentAddress ZRO payment address
     * @param adapterParams Adapter parameters
     */
    function enhancedSendFrom(
        address from,
        uint16 dstChainId,
        bytes calldata toAddress,
        uint256 amount,
        address payable refundAddress,
        address zroPaymentAddress,
        bytes calldata adapterParams
    ) external payable whenNotPaused nonReentrant {
        if (chainEmergencyMode[dstChainId]) revert EmergencyModeActive();
        
        // Track bridge volume if feature is enabled
        if (newFeatureEnabled) {
            totalBridgedOut += amount;
            userBridgeVolume[from] += amount;
            emit BridgeVolumeUpdated(from, userBridgeVolume[from], dstChainId);
        }
        
        // Call parent sendFrom functionality
        sendFrom(from, dstChainId, toAddress, amount, refundAddress, zroPaymentAddress, adapterParams);
    }
    
    /**
     * @dev Get bridge volume statistics for user (V2 feature)
     * @param user User address to check
     * @return volume Total bridge volume for user
     */
    function getUserBridgeVolume(address user) external view returns (uint256 volume) {
        return userBridgeVolume[user];
    }
    
    /**
     * @dev Get total bridge statistics (V2 feature)
     * @return bridgedIn Total tokens bridged in
     * @return bridgedOut Total tokens bridged out
     */
    function getTotalBridgeStats() external view returns (uint256 bridgedIn, uint256 bridgedOut) {
        return (totalBridgedIn, totalBridgedOut);
    }
    
    /**
     * @dev Check if chain is in emergency mode (V2 feature)
     * @param chainId Chain ID to check
     * @return inEmergency True if chain is in emergency mode
     */
    function isChainInEmergency(uint16 chainId) external view returns (bool inEmergency) {
        return chainEmergencyMode[chainId];
    }
    
    /**
     * @dev Override lzReceive to add volume tracking (V2 enhancement)
     */
    function lzReceive(
        uint16 srcChainId,
        bytes calldata srcAddress,
        uint64 nonce,
        bytes calldata payload
    ) external override whenNotPaused {
        // Check emergency mode
        if (chainEmergencyMode[srcChainId]) revert EmergencyModeActive();
        
        // Call parent lzReceive implementation
        // First perform parent validation and processing
        require(msg.sender == address(lzEndpoint), "LookCoin: invalid endpoint caller");
        
        // Verify trusted source
        bytes32 srcAddressBytes32;
        assembly {
            srcAddressBytes32 := calldataload(add(srcAddress.offset, 0))
        }
        require(srcAddressBytes32 == trustedRemoteLookup[srcChainId], "LookCoin: source not trusted");

        // Prevent replay attacks
        require(!processedNonces[srcChainId][nonce], "LookCoin: nonce already processed");
        processedNonces[srcChainId][nonce] = true;

        // Decode payload
        (uint16 packetType, address sender, bytes memory toAddressBytes, uint256 amount) = abi.decode(
            payload,
            (uint16, address, bytes, uint256)
        );

        require(packetType == 0, "MockUpgradeTarget: invalid packet type"); // PT_SEND = 0

        // Decode recipient address
        address toAddress;
        assembly {
            toAddress := mload(add(toAddressBytes, 20))
        }

        require(toAddress != address(0), "MockUpgradeTarget: mint to zero address");

        // Track bridge volume if feature is enabled (before minting)
        if (newFeatureEnabled) {
            totalBridgedIn += amount;
            userBridgeVolume[toAddress] += amount;
            emit BridgeVolumeUpdated(toAddress, userBridgeVolume[toAddress], srcChainId);
        }

        // Mint tokens to recipient
        totalMinted += amount;
        _mint(toAddress, amount);

        emit CrossChainTransferReceived(srcChainId, abi.encodePacked(sender), toAddress, amount);
    }
    
    /**
     * @dev Get upgrade history (V2 feature)
     * @param index History index to retrieve
     * @return implementation Implementation address at that index
     */
    function getUpgradeHistory(uint256 index) external view returns (address implementation) {
        require(index < upgradeCount, "MockUpgradeTarget: invalid history index");
        return upgradeHistory[index];
    }
    
    /**
     * @dev Record new upgrade in history (V2 feature)
     * @param newImplementation Address of new implementation
     */
    function recordUpgrade(address newImplementation) external onlyRole(UPGRADER_ROLE) {
        upgradeHistory[upgradeCount] = newImplementation;
        upgradeCount++;
    }
    
    /**
     * @dev Enhanced supply check with bridge volume validation (V2 feature)
     * @return supplyValid True if supply accounting is valid
     */
    function validateEnhancedSupply() external view returns (bool supplyValid) {
        // Basic supply invariant check
        if (totalSupply() != totalMinted - totalBurned) {
            return false;
        }
        
        // If new feature enabled, validate bridge volume accounting
        if (newFeatureEnabled) {
            // Bridge volume should not exceed total minted/burned amounts
            if (totalBridgedIn > totalMinted || totalBridgedOut > totalBurned) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * @dev Emergency reset function for testing rollback scenarios (V2 feature)
     * @notice This function is only for testing purposes
     */
    function emergencyReset() external onlyRole(DEFAULT_ADMIN_ROLE) {
        isUpgraded = false;
        newFeatureEnabled = false;
        pauseReason = "";
        totalBridgedIn = 0;
        totalBridgedOut = 0;
        upgradeCount = 0;
        
        // Clear emergency modes for all chains
        // Note: This is a simplified reset - real implementation would iterate through known chains
    }
    
    /**
     * @dev Test function to simulate upgrade failure scenario
     * @param shouldFail Whether this function should revert
     */
    function testUpgradeFailure(bool shouldFail) external view {
        if (shouldFail) {
            revert InvalidUpgradeTarget();
        }
        // Function succeeds if shouldFail is false
    }
    
    /**
     * @dev Simulate heavy computation for gas testing
     * @param iterations Number of iterations to perform
     * @return result Computed result
     */
    function heavyComputationTest(uint256 iterations) external pure returns (uint256 result) {
        for (uint256 i = 0; i < iterations; i++) {
            result += i * i;
        }
        return result;
    }
    
    /**
     * @dev Override supportsInterface to include V2 interfaces
     */
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        // Add support for mock interface ID
        if (interfaceId == bytes4(keccak256("MockUpgradeTarget"))) {
            return true;
        }
        return super.supportsInterface(interfaceId);
    }
    
    /**
     * @dev Get contract storage usage statistics (for testing)
     * @return slotsUsed Approximate number of storage slots used
     * @return gapRemaining Remaining storage gap size
     */
    function getStorageStats() external pure returns (uint256 slotsUsed, uint256 gapRemaining) {
        // MockUpgradeTarget uses approximately 25 storage slots
        // (This is an estimate for testing purposes)
        slotsUsed = 25;
        gapRemaining = 35; // __gapV2 size
        return (slotsUsed, gapRemaining);
    }
    
    /**
     * @dev Test function for cross-version compatibility
     * @return compatible True if contract maintains backward compatibility
     */
    function testBackwardCompatibility() external view returns (bool compatible) {
        // Test that V1 functions still work
        try this.name() returns (string memory) {
            try this.symbol() returns (string memory) {
                try this.decimals() returns (uint8) {
                    return true;
                } catch {
                    return false;
                }
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}