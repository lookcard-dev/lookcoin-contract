// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

interface IPausable {
    function pause() external;
    function unpause() external;
}

/**
 * @title SupplyOracle
 * @dev Cross-chain supply reconciliation oracle for monitoring token supply consistency
 */
contract SupplyOracle is AccessControlUpgradeable, PausableUpgradeable {
    // Role definitions
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Chain identifiers
    uint16 public constant CHAIN_BSC = 56;
    uint16 public constant CHAIN_BASE = 8453;
    uint16 public constant CHAIN_OPTIMISM = 10;
    uint16 public constant CHAIN_SAPPHIRE = 23295;
    uint16 public constant CHAIN_AKASHIC = 999;

    // Supply data structure
    struct ChainSupply {
        uint256 totalSupply;
        uint256 lockedSupply;
        uint256 circulatingSupply;
        uint256 lastUpdateTime;
        uint256 updateCount;
    }

    // State variables
    mapping(uint16 => ChainSupply) public chainSupplies;
    mapping(uint16 => address[]) public bridgeContracts;
    uint16[] public supportedChains;
    
    // Reconciliation parameters
    uint256 public reconciliationInterval = 15 minutes;
    uint256 public toleranceThreshold = 1000 * 10**18; // 1000 tokens
    uint256 public lastReconciliationTime;
    uint256 public totalExpectedSupply;
    
    // Emergency response
    bool public emergencyMode;
    mapping(address => bool) public pausedBridges;
    
    // Multi-signature validation
    uint256 public requiredSignatures = 3;
    mapping(bytes32 => mapping(address => bool)) public updateSignatures;
    mapping(bytes32 => uint256) public updateSignatureCount;
    
    // Events
    event SupplyUpdated(
        uint16 indexed chainId,
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

    /**
     * @dev Initialize the supply oracle
     * @param _admin Admin address
     * @param _totalSupply Total expected supply across all chains
     */
    function initialize(
        address _admin,
        uint256 _totalSupply
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ORACLE_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
        
        totalExpectedSupply = _totalSupply;
        
        // Initialize supported chains
        supportedChains.push(CHAIN_BSC);
        supportedChains.push(CHAIN_BASE);
        supportedChains.push(CHAIN_OPTIMISM);
        supportedChains.push(CHAIN_SAPPHIRE);
        supportedChains.push(CHAIN_AKASHIC);
    }

    /**
     * @dev Update supply data for a chain (requires multi-sig)
     * @param _chainId Chain identifier
     * @param _totalSupply Total supply on chain
     * @param _lockedSupply Locked supply in bridges
     * @param _nonce Update nonce for multi-sig
     */
    function updateSupply(
        uint16 _chainId,
        uint256 _totalSupply,
        uint256 _lockedSupply,
        uint256 _nonce
    ) external onlyRole(ORACLE_ROLE) whenNotPaused {
        bytes32 updateHash = keccak256(
            abi.encodePacked(_chainId, _totalSupply, _lockedSupply, _nonce)
        );
        
        require(!updateSignatures[updateHash][msg.sender], "SupplyOracle: already signed");
        
        updateSignatures[updateHash][msg.sender] = true;
        updateSignatureCount[updateHash]++;
        
        if (updateSignatureCount[updateHash] >= requiredSignatures) {
            _executeSupplyUpdate(_chainId, _totalSupply, _lockedSupply);
            _resetSignatures(updateHash);
        }
    }

    /**
     * @dev Execute supply update after multi-sig validation
     */
    function _executeSupplyUpdate(
        uint16 _chainId,
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
    function registerBridge(uint16 _chainId, address _bridge) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(_bridge != address(0), "SupplyOracle: invalid bridge");
        bridgeContracts[_chainId].push(_bridge);
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
        // Note: In production, implement proper cleanup of mapping
        updateSignatureCount[_updateHash] = 0;
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
}