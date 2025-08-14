// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../LookCoin.sol";

/**
 * @title MockUpgradeTargetMinimal
 * @dev Minimal mock upgraded version of LookCoin for testing upgrade scenarios
 * 
 * This is a simplified version of MockUpgradeTarget designed to stay within
 * the 24KB contract size limit while still providing essential upgrade testing functionality.
 * 
 * Key Features:
 * - All LookCoin V1 functionality preserved
 * - Essential upgrade-specific test functions
 * - Version tracking
 * - Storage layout compatibility testing
 * 
 * Testing Focus:
 * - Validate state preservation during upgrades
 * - Test new functionality activation
 * - Verify storage layout compatibility
 * - Test version compatibility
 */
contract MockUpgradeTargetMinimal is LookCoin {
    // Version information
    string public constant VERSION = "2.0.0";
    uint256 public constant UPGRADE_TIMESTAMP = 1699920000;
    
    // Essential V2 state variables
    bool public isUpgraded;
    bool public newFeatureEnabled;
    string public pauseReason;
    uint256 public upgradeCount;
    
    // Enhanced supply tracking
    uint256 public totalBridgedIn;
    uint256 public totalBridgedOut;
    
    // Storage gap (reduced from original 48 due to new variables)
    uint256[42] private __gapV2;
    
    // V2 Events
    event UpgradeCompleted(string version, uint256 timestamp, address indexed upgrader);
    event NewFeatureActivated(string feature, bool enabled, address indexed activator);
    
    // V2 Custom Errors
    error UpgradeNotInitialized();
    error NewFeatureNotEnabled();
    
    /**
     * @dev Initialize V2 features (called during upgrade if needed)
     */
    function initializeV2() external onlyRole(UPGRADER_ROLE) {
        require(!isUpgraded, "MockUpgradeTargetMinimal: already initialized");
        
        isUpgraded = true;
        newFeatureEnabled = false;
        pauseReason = "";
        upgradeCount = 1;
        
        emit UpgradeCompleted(VERSION, UPGRADE_TIMESTAMP, msg.sender);
    }
    
    /**
     * @dev Get contract version
     */
    function getVersion() external pure returns (string memory version) {
        return VERSION;
    }
    
    /**
     * @dev Enhanced pause function with reason (V2 feature)
     */
    function pauseWithReason(string calldata reason) external onlyRole(PAUSER_ROLE) {
        if (!isUpgraded) revert UpgradeNotInitialized();
        
        pauseReason = reason;
        _pause();
    }
    
    /**
     * @dev Toggle new feature (V2 functionality)
     */
    function setNewFeatureEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isUpgraded) revert UpgradeNotInitialized();
        
        newFeatureEnabled = enabled;
        emit NewFeatureActivated("enhanced_features", enabled, msg.sender);
    }
    
    /**
     * @dev Enhanced mint with tracking (V2 feature)
     */
    function enhancedMint(address to, uint256 amount) external whenNotPaused nonReentrant supplyInvariant {
        require(hasRole(MINTER_ROLE, msg.sender) || hasRole(BRIDGE_ROLE, msg.sender), "MockUpgradeTargetMinimal: unauthorized");
        
        if (newFeatureEnabled) {
            totalBridgedIn += amount;
        }
        
        totalMinted += amount;
        _mint(to, amount);
    }
    
    /**
     * @dev Enhanced burn with tracking (V2 feature)
     */
    function enhancedBurn(address from, uint256 amount) external whenNotPaused nonReentrant supplyInvariant {
        require(hasRole(BURNER_ROLE, msg.sender) || hasRole(BRIDGE_ROLE, msg.sender), "MockUpgradeTargetMinimal: unauthorized");
        
        if (newFeatureEnabled) {
            totalBridgedOut += amount;
        }
        
        totalBurned += amount;
        _burn(from, amount);
    }
    
    /**
     * @dev Override lzReceive to add minimal tracking (V2 enhancement)
     */
    function lzReceive(
        uint16 srcChainId,
        bytes calldata srcAddress,
        uint64 nonce,
        bytes calldata payload
    ) external virtual override whenNotPaused {
        // Call parent lzReceive logic inline
        require(msg.sender == address(lzEndpoint), "MockUpgradeTargetMinimal: invalid endpoint caller");

        // Verify trusted source
        bytes32 srcAddressBytes32;
        assembly {
            srcAddressBytes32 := calldataload(add(srcAddress.offset, 0))
        }
        require(srcAddressBytes32 == trustedRemoteLookup[srcChainId], "MockUpgradeTargetMinimal: source not trusted");

        // Prevent replay attacks
        require(!processedNonces[srcChainId][nonce], "MockUpgradeTargetMinimal: nonce already processed");
        processedNonces[srcChainId][nonce] = true;

        // Decode payload
        (uint16 packetType, address sender, bytes memory toAddressBytes, uint256 amount) = abi.decode(
            payload,
            (uint16, address, bytes, uint256)
        );

        require(packetType == 0, "MockUpgradeTargetMinimal: invalid packet type"); // PT_SEND = 0

        // Decode recipient address
        address toAddress;
        assembly {
            toAddress := mload(add(toAddressBytes, 20))
        }

        require(toAddress != address(0), "MockUpgradeTargetMinimal: mint to zero address");

        // Track bridge volume if feature is enabled
        if (newFeatureEnabled) {
            totalBridgedIn += amount;
        }

        // Mint tokens to recipient
        totalMinted += amount;
        _mint(toAddress, amount);

        emit CrossChainTransferReceived(srcChainId, abi.encodePacked(sender), toAddress, amount);
    }
    
    /**
     * @dev Get total bridge statistics (V2 feature)
     */
    function getTotalBridgeStats() external view returns (uint256 bridgedIn, uint256 bridgedOut) {
        return (totalBridgedIn, totalBridgedOut);
    }
    
    /**
     * @dev Enhanced supply validation (V2 feature)
     */
    function validateEnhancedSupply() external view returns (bool supplyValid) {
        // Basic supply invariant check
        if (totalSupply() != totalMinted - totalBurned) {
            return false;
        }
        
        // If new feature enabled, validate bridge volume accounting
        if (newFeatureEnabled) {
            if (totalBridgedIn > totalMinted || totalBridgedOut > totalBurned) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * @dev Test function for upgrade failure scenarios
     */
    function testUpgradeFailure(bool shouldFail) external pure {
        if (shouldFail) {
            revert("MockUpgradeTargetMinimal: intentional failure");
        }
    }
    
    /**
     * @dev Override supportsInterface to include V2 interfaces
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        if (interfaceId == bytes4(keccak256("MockUpgradeTargetMinimal"))) {
            return true;
        }
        return super.supportsInterface(interfaceId);
    }
    
    /**
     * @dev Get storage statistics (for testing)
     */
    function getStorageStats() external pure returns (uint256 slotsUsed, uint256 gapRemaining) {
        slotsUsed = 15; // Fewer slots than full version
        gapRemaining = 42;
        return (slotsUsed, gapRemaining);
    }
    
    /**
     * @dev Test backward compatibility
     */
    function testBackwardCompatibility() external view returns (bool compatible) {
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