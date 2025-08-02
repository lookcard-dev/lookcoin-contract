// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

interface IPausable {
    function pause() external;
    function unpause() external;
}

/**
 * @title SupplyOracle
 * @dev Cross-chain supply reconciliation oracle for monitoring token supply consistency
 */
contract SupplyOracle is AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    // Role definitions
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Supply data structure
    struct ChainSupply {
        uint256 totalSupply;
        uint256 lockedSupply;
        uint256 circulatingSupply;
        uint256 lastUpdateTime;
        uint256 updateCount;
    }

    // State variables
    mapping(uint32 => ChainSupply) public chainSupplies;
    mapping(uint32 => address[]) public bridgeContracts;
    uint32[] public supportedChains;
    
    // Batch update structure
    struct BatchSupplyUpdate {
        uint32 chainId;
        uint256 totalSupply;
        uint256 lockedSupply;
    }
    
    // Reconciliation parameters
    uint256 public reconciliationInterval;
    uint256 public toleranceThreshold;
    uint256 public lastReconciliationTime;
    uint256 public totalExpectedSupply;
    
    // Emergency response
    bool public emergencyMode;
    mapping(address => bool) public pausedBridges;
    
    // Multi-signature validation
    uint256 public requiredSignatures;
    mapping(bytes32 => mapping(address => bool)) public updateSignatures;
    mapping(bytes32 => uint256) public updateSignatureCount;
    
    // Nonce tracking to prevent replay attacks
    mapping(uint256 => bool) private usedNonces;
    uint256 public constant NONCE_VALIDITY_PERIOD = 1 hours;
    
    // Events
    event SupplyUpdated(
        uint32 indexed chainId,
        uint256 totalSupply,
        uint256 lockedSupply,
        uint256 circulatingSupply
    );
    event SupplyMismatchDetected(
        uint256 expectedSupply,
        uint256 actualSupply,
        uint256 discrepancy
    );
    event BridgePaused(address indexed bridge, string reason);
    event BridgeUnpaused(address indexed bridge);
    event ReconciliationCompleted(uint256 timestamp, bool success);
    event EmergencyModeActivated(address indexed activator);
    event EmergencyModeDeactivated(address indexed deactivator);
    event ExpectedSupplyUpdated(uint256 oldSupply, uint256 newSupply);

    /**
     * @dev Initialize the supply oracle
     * @param _admin Admin address
     * @param _totalSupply Total expected supply across all chains
     * @param _supportedChains Array of supported chain IDs
     */
    function initialize(
        address _admin,
        uint256 _totalSupply,
        uint32[] memory _supportedChains
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ORACLE_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
        
        totalExpectedSupply = _totalSupply;
        
        // Set default values for reconciliation parameters
        reconciliationInterval = 15 minutes;
        toleranceThreshold = 1000 * 10**18; // 1000 tokens
        requiredSignatures = 3;
        
        // Initialize supported chains from provided array
        require(_supportedChains.length > 0, "SupplyOracle: no chains provided");
        require(_supportedChains.length <= 10, "SupplyOracle: too many chains");
        
        for (uint i = 0; i < _supportedChains.length; i++) {
            require(_supportedChains[i] > 0, "SupplyOracle: invalid chain ID");
            // Check for duplicates
            for (uint j = 0; j < i; j++) {
                require(_supportedChains[i] != _supportedChains[j], "SupplyOracle: duplicate chain ID");
            }
            supportedChains.push(_supportedChains[i]);
        }
    }

    /**
     * @dev Update supply data for a chain (requires multi-sig)
     * @param _chainId Chain identifier
     * @param _totalSupply Total supply on chain
     * @param _lockedSupply Locked supply in bridges
     * @param _nonce Update nonce for multi-sig
     */
    function updateSupply(
        uint32 _chainId,
        uint256 _totalSupply,
        uint256 _lockedSupply,
        uint256 _nonce
    ) external onlyRole(ORACLE_ROLE) whenNotPaused {
        // Validate nonce to prevent replay attacks
        require(!usedNonces[_nonce], "SupplyOracle: nonce already used");
        require(_nonce > block.timestamp - NONCE_VALIDITY_PERIOD, "SupplyOracle: nonce too old");
        require(_nonce <= block.timestamp + 5 minutes, "SupplyOracle: nonce too far in future");
        
        bytes32 updateHash = keccak256(
            abi.encodePacked(_chainId, _totalSupply, _lockedSupply, _nonce)
        );
        
        require(!updateSignatures[updateHash][msg.sender], "SupplyOracle: already signed");
        
        updateSignatures[updateHash][msg.sender] = true;
        updateSignatureCount[updateHash]++;
        
        if (updateSignatureCount[updateHash] >= requiredSignatures) {
            usedNonces[_nonce] = true;
            _executeSupplyUpdate(_chainId, _totalSupply, _lockedSupply);
            _resetSignatures(updateHash);
        }
    }

    /**
     * @dev Batch update supply data for multiple chains in a single transaction
     * @param updates Array of supply updates for all chains
     * @param nonce Update nonce for multi-sig coordination
     */
    function batchUpdateSupply(
        BatchSupplyUpdate[] calldata updates,
        uint256 nonce
    ) external onlyRole(ORACLE_ROLE) whenNotPaused {
        // Validate nonce to prevent replay attacks
        require(!usedNonces[nonce], "SupplyOracle: nonce already used");
        require(nonce > block.timestamp - NONCE_VALIDITY_PERIOD, "SupplyOracle: nonce too old");
        require(nonce <= block.timestamp + 5 minutes, "SupplyOracle: nonce too far in future");
        
        bytes32 updateHash = keccak256(abi.encode(updates, nonce));
        
        require(!updateSignatures[updateHash][msg.sender], "SupplyOracle: already signed");
        
        updateSignatures[updateHash][msg.sender] = true;
        updateSignatureCount[updateHash]++;
        
        if (updateSignatureCount[updateHash] >= requiredSignatures) {
            usedNonces[nonce] = true;
            _executeBatchUpdate(updates);
            _resetSignatures(updateHash);
        }
    }

    /**
     * @dev Execute supply update after multi-sig validation
     */
    function _executeSupplyUpdate(
        uint32 _chainId,
        uint256 _totalSupply,
        uint256 _lockedSupply
    ) internal {
        uint256 circulatingSupply = _totalSupply - _lockedSupply;
        
        chainSupplies[_chainId] = ChainSupply({
            totalSupply: _totalSupply,
            lockedSupply: _lockedSupply,
            circulatingSupply: circulatingSupply,
            lastUpdateTime: block.timestamp,
            updateCount: chainSupplies[_chainId].updateCount + 1
        });
        
        emit SupplyUpdated(_chainId, _totalSupply, _lockedSupply, circulatingSupply);
        
        // Check if reconciliation is needed
        if (block.timestamp >= lastReconciliationTime + reconciliationInterval) {
            _reconcileSupply();
        }
    }

    /**
     * @dev Reconcile supply across all chains
     */
    function reconcileSupply() external onlyRole(OPERATOR_ROLE) {
        _reconcileSupply();
    }

    /**
     * @dev Execute batch supply update after multi-sig validation
     */
    function _executeBatchUpdate(BatchSupplyUpdate[] calldata updates) internal {
        uint256 totalActualSupply = 0;
        
        for (uint i = 0; i < updates.length; i++) {
            BatchSupplyUpdate calldata update = updates[i];
            uint256 circulatingSupply = update.totalSupply - update.lockedSupply;
            
            chainSupplies[update.chainId] = ChainSupply({
                totalSupply: update.totalSupply,
                lockedSupply: update.lockedSupply,
                circulatingSupply: circulatingSupply,
                lastUpdateTime: block.timestamp,
                updateCount: chainSupplies[update.chainId].updateCount + 1
            });
            
            totalActualSupply += update.totalSupply;
            
            emit SupplyUpdated(
                update.chainId, 
                update.totalSupply, 
                update.lockedSupply, 
                circulatingSupply
            );
        }
        
        // Check total supply health
        uint256 discrepancy = totalActualSupply > totalExpectedSupply ? 
            totalActualSupply - totalExpectedSupply : 
            totalExpectedSupply - totalActualSupply;
            
        if (discrepancy > toleranceThreshold && !emergencyMode) {
            emit SupplyMismatchDetected(totalExpectedSupply, totalActualSupply, discrepancy);
            _pauseAllBridges("Supply mismatch detected");
        }
        
        lastReconciliationTime = block.timestamp;
        emit ReconciliationCompleted(block.timestamp, discrepancy <= toleranceThreshold);
    }

    /**
     * @dev Internal reconciliation logic
     */
    function _reconcileSupply() internal {
        uint256 totalActualSupply = 0;
        uint256 totalCirculating = 0;
        uint256 totalLocked = 0;
        
        // Calculate total supply across all chains
        for (uint i = 0; i < supportedChains.length; i++) {
            ChainSupply memory supply = chainSupplies[supportedChains[i]];
            totalActualSupply += supply.totalSupply;
            totalCirculating += supply.circulatingSupply;
            totalLocked += supply.lockedSupply;
        }
        
        // Check supply consistency
        uint256 discrepancy = totalActualSupply > totalExpectedSupply ? 
            totalActualSupply - totalExpectedSupply : 
            totalExpectedSupply - totalActualSupply;
            
        bool success = discrepancy <= toleranceThreshold;
        
        if (!success && !emergencyMode) {
            emit SupplyMismatchDetected(totalExpectedSupply, totalActualSupply, discrepancy);
            _pauseAllBridges("Supply mismatch detected");
        }
        
        lastReconciliationTime = block.timestamp;
        emit ReconciliationCompleted(block.timestamp, success);
    }

    /**
     * @dev Pause specific bridges on supply mismatch
     * @param _reason Pause reason
     */
    function pauseBridgesOnMismatch(string memory _reason) 
        external 
        onlyRole(EMERGENCY_ROLE) 
    {
        _pauseAllBridges(_reason);
    }

    /**
     * @dev Pause all registered bridges
     */
    function _pauseAllBridges(string memory _reason) internal {
        for (uint i = 0; i < supportedChains.length; i++) {
            address[] memory bridges = bridgeContracts[supportedChains[i]];
            for (uint j = 0; j < bridges.length; j++) {
                if (!pausedBridges[bridges[j]]) {
                    try IPausable(bridges[j]).pause() {
                        pausedBridges[bridges[j]] = true;
                        emit BridgePaused(bridges[j], _reason);
                    } catch {
                        // Log failure but continue
                    }
                }
            }
        }
    }

    /**
     * @dev Unpause specific bridge
     * @param _bridge Bridge address
     */
    function unpauseBridge(address _bridge) external onlyRole(OPERATOR_ROLE) {
        require(pausedBridges[_bridge], "SupplyOracle: bridge not paused");
        
        IPausable(_bridge).unpause();
        pausedBridges[_bridge] = false;
        emit BridgeUnpaused(_bridge);
    }

    /**
     * @dev Get all supported chain IDs
     */
    function getSupportedChains() external view returns (uint32[] memory) {
        return supportedChains;
    }

    /**
     * @dev Get global supply summary
     */
    function getGlobalSupply() external view returns (
        uint256 expectedSupply,
        uint256 actualSupply,
        uint256 circulatingSupply,
        uint256 lockedSupply,
        bool isHealthy
    ) {
        expectedSupply = totalExpectedSupply;
        
        for (uint i = 0; i < supportedChains.length; i++) {
            ChainSupply memory supply = chainSupplies[supportedChains[i]];
            actualSupply += supply.totalSupply;
            circulatingSupply += supply.circulatingSupply;
            lockedSupply += supply.lockedSupply;
        }
        
        uint256 discrepancy = actualSupply > expectedSupply ? 
            actualSupply - expectedSupply : 
            expectedSupply - actualSupply;
            
        isHealthy = discrepancy <= toleranceThreshold;
    }

    /**
     * @dev Register bridge contract
     * @param _chainId Chain identifier
     * @param _bridge Bridge contract address
     */
    function registerBridge(uint32 _chainId, address _bridge) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(_bridge != address(0), "SupplyOracle: invalid bridge");
        
        // Check if bridge is already registered
        address[] storage bridges = bridgeContracts[_chainId];
        for (uint i = 0; i < bridges.length; i++) {
            require(bridges[i] != _bridge, "SupplyOracle: bridge already registered");
        }
        
        bridgeContracts[_chainId].push(_bridge);
    }

    /**
     * @dev Check if a bridge is registered for a chain
     * @param _chainId Chain identifier
     * @param _bridge Bridge contract address
     * @return isRegistered True if bridge is registered
     */
    function isBridgeRegistered(uint32 _chainId, address _bridge) 
        external 
        view 
        returns (bool isRegistered) 
    {
        address[] memory bridges = bridgeContracts[_chainId];
        for (uint i = 0; i < bridges.length; i++) {
            if (bridges[i] == _bridge) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Update reconciliation parameters
     * @param _interval Reconciliation interval in seconds
     * @param _threshold Tolerance threshold
     */
    function updateReconciliationParams(
        uint256 _interval,
        uint256 _threshold
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_interval >= 5 minutes, "SupplyOracle: interval too short");
        reconciliationInterval = _interval;
        toleranceThreshold = _threshold;
    }

    /**
     * @dev Update required signatures for multi-sig
     * @param _required Number of required signatures
     */
    function updateRequiredSignatures(uint256 _required) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(_required > 0 && _required <= 5, "SupplyOracle: invalid signature count");
        requiredSignatures = _required;
    }

    /**
     * @dev Update the total expected supply across all chains
     * @param _newExpectedSupply New total expected supply
     */
    function updateExpectedSupply(uint256 _newExpectedSupply) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(_newExpectedSupply > 0, "SupplyOracle: invalid supply");
        uint256 oldSupply = totalExpectedSupply;
        totalExpectedSupply = _newExpectedSupply;
        
        emit ExpectedSupplyUpdated(oldSupply, _newExpectedSupply);
    }

    /**
     * @dev Activate emergency mode
     */
    function activateEmergencyMode() external onlyRole(EMERGENCY_ROLE) {
        emergencyMode = true;
        _pauseAllBridges("Emergency mode activated");
        emit EmergencyModeActivated(msg.sender);
    }

    /**
     * @dev Deactivate emergency mode
     */
    function deactivateEmergencyMode() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyMode = false;
        emit EmergencyModeDeactivated(msg.sender);
    }

    /**
     * @dev Reset signatures for update hash
     */
    function _resetSignatures(bytes32 _updateHash) internal {
        // Clear the signature count
        delete updateSignatureCount[_updateHash];
        // Note: Without enumerable roles, we cannot efficiently clear individual oracle signatures
        // In production, consider maintaining a separate array of oracle addresses for cleanup
    }

    /**
     * @dev Pause oracle operations
     */
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause oracle operations
     */
    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Override supportsInterface for multiple inheritance
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Authorize upgrade for UUPS proxy
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}