// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title FailureSimulator
 * @dev Mock contract to simulate various infrastructure failures for testing recovery procedures
 */
contract FailureSimulator is Initializable, AccessControlUpgradeable, PausableUpgradeable {
    bytes32 public constant FAILURE_ADMIN_ROLE = keccak256("FAILURE_ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Failure states and conditions
    struct NetworkConditions {
        uint256 latency;          // Network latency in milliseconds
        uint256 packetLoss;       // Packet loss percentage (0-100)
        uint256 jitter;           // Network jitter in milliseconds
        uint256 bandwidth;        // Available bandwidth (bytes/sec)
        bool isPartitioned;       // Network partition flag
        bool hasReorg;           // Chain reorganization flag
        uint256 reorgDepth;      // Depth of reorganization
    }

    struct RPCEndpoint {
        string url;
        bool isHealthy;
        uint256 responseTime;     // Average response time in ms
        uint256 errorRate;        // Error rate percentage (0-100)
        uint256 lastFailure;      // Timestamp of last failure
        uint256 failureCount;     // Total failure count
    }

    struct OracleNode {
        address nodeAddress;
        bool isOnline;
        bool isSynced;
        uint256 lastHeartbeat;
        uint256 latency;
        bool hasCorruptedData;
        uint256 corruptionPercent; // 0-100
    }

    struct ValidatorSet {
        mapping(address => bool) isValidator;
        mapping(address => bool) isCorrupted;
        mapping(address => uint256) lastActivity;
        address[] activeValidators;
        uint256 totalValidators;
        uint256 corruptedCount;
        uint256 minimumRequired;
    }

    // State mappings
    mapping(uint256 => NetworkConditions) public networkConditions;
    mapping(bytes32 => RPCEndpoint) public rpcEndpoints;
    mapping(address => OracleNode) public oracleNodes;
    mapping(uint256 => ValidatorSet) internal validatorSets; // chainId => ValidatorSet

    // Bridge failure simulation
    mapping(uint256 => mapping(bytes32 => bool)) public bridgeFailures; // protocol => messageId => failed
    mapping(uint256 => bool) public protocolStatus; // protocol => isHealthy
    mapping(uint256 => uint256) public protocolLatency; // protocol => latency
    mapping(uint256 => uint256) public protocolErrorRate; // protocol => error rate

    // Region coordination tracking
    struct Region {
        string name;
        bool isOnline;
        uint256 lastSync;
        mapping(uint256 => bool) chainSyncStatus; // chainId => synced
        uint256[] supportedChains;
    }
    mapping(bytes32 => Region) public regions;
    bytes32[] public regionList;

    // Recovery tracking
    struct RecoveryMetrics {
        uint256 recoveryStartTime;
        uint256 recoveryEndTime;
        uint256 rto; // Recovery Time Objective
        uint256 rpo; // Recovery Point Objective
        bool isRecovering;
        string failureType;
        bytes32 recoveryProcedureId;
    }
    mapping(bytes32 => RecoveryMetrics) public recoveryMetrics;

    // Events
    event NetworkPartitionSimulated(uint256[] chainIds, uint256 duration);
    event NetworkPartitionResolved(uint256[] chainIds);
    event RPCEndpointFailed(bytes32 endpointId, string reason);
    event RPCEndpointRecovered(bytes32 endpointId, uint256 downtime);
    event OracleNodeCorrupted(address node, uint256 corruptionPercent);
    event OracleNodeRecovered(address node);
    event ValidatorSetCorrupted(uint256 chainId, uint256 corruptedCount);
    event ValidatorSetRecovered(uint256 chainId);
    event BridgeModuleFailure(uint256 protocol, bytes32 messageId);
    event BridgeModuleRecovered(uint256 protocol);
    event RegionCoordinationFailure(bytes32 regionId, uint256[] affectedChains);
    event RegionCoordinationRecovered(bytes32 regionId);
    event EmergencyMigrationInitiated(bytes32 migrationId, string fromSystem, string toSystem);
    event EmergencyMigrationCompleted(bytes32 migrationId, uint256 duration);
    event RecoveryProcedureStarted(bytes32 procedureId, string failureType, uint256 rto, uint256 rpo);
    event RecoveryProcedureCompleted(bytes32 procedureId, uint256 actualRecoveryTime);

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __Pausable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FAILURE_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // Network failure simulation
    function simulateNetworkPartition(uint256[] calldata chainIds, uint256 duration) external onlyRole(FAILURE_ADMIN_ROLE) {
        for (uint256 i = 0; i < chainIds.length; i++) {
            networkConditions[chainIds[i]].isPartitioned = true;
        }
        emit NetworkPartitionSimulated(chainIds, duration);
    }

    function resolveNetworkPartition(uint256[] calldata chainIds) external onlyRole(OPERATOR_ROLE) {
        for (uint256 i = 0; i < chainIds.length; i++) {
            networkConditions[chainIds[i]].isPartitioned = false;
        }
        emit NetworkPartitionResolved(chainIds);
    }

    function setNetworkConditions(
        uint256 chainId,
        uint256 latency,
        uint256 packetLoss,
        uint256 jitter,
        uint256 bandwidth
    ) external onlyRole(FAILURE_ADMIN_ROLE) {
        NetworkConditions storage conditions = networkConditions[chainId];
        conditions.latency = latency;
        conditions.packetLoss = packetLoss;
        conditions.jitter = jitter;
        conditions.bandwidth = bandwidth;
    }

    function simulateChainReorg(uint256 chainId, uint256 depth) external onlyRole(FAILURE_ADMIN_ROLE) {
        networkConditions[chainId].hasReorg = true;
        networkConditions[chainId].reorgDepth = depth;
    }

    function resolveChainReorg(uint256 chainId) external onlyRole(OPERATOR_ROLE) {
        networkConditions[chainId].hasReorg = false;
        networkConditions[chainId].reorgDepth = 0;
    }

    // RPC endpoint failure simulation
    function registerRPCEndpoint(bytes32 endpointId, string calldata url) external onlyRole(FAILURE_ADMIN_ROLE) {
        RPCEndpoint storage endpoint = rpcEndpoints[endpointId];
        endpoint.url = url;
        endpoint.isHealthy = true;
        endpoint.responseTime = 100; // Default 100ms
        endpoint.errorRate = 0;
        endpoint.lastFailure = 0;
        endpoint.failureCount = 0;
    }

    function simulateRPCFailure(bytes32 endpointId, string calldata reason) external onlyRole(FAILURE_ADMIN_ROLE) {
        RPCEndpoint storage endpoint = rpcEndpoints[endpointId];
        endpoint.isHealthy = false;
        endpoint.lastFailure = block.timestamp;
        endpoint.failureCount++;
        emit RPCEndpointFailed(endpointId, reason);
    }

    function simulateRPCCascadeFailure(bytes32[] calldata endpointIds) external onlyRole(FAILURE_ADMIN_ROLE) {
        for (uint256 i = 0; i < endpointIds.length; i++) {
            // Inline the failure simulation logic for cascade failures
            RPCEndpoint storage endpoint = rpcEndpoints[endpointIds[i]];
            endpoint.isHealthy = false;
            endpoint.lastFailure = block.timestamp;
            endpoint.failureCount++;
            emit RPCEndpointFailed(endpointIds[i], "Cascade failure");
            
            // Simulate gradual failure with delays
            if (i > 0) {
                // In real testing, this would involve time manipulation
            }
        }
    }

    function recoverRPCEndpoint(bytes32 endpointId) external onlyRole(OPERATOR_ROLE) {
        RPCEndpoint storage endpoint = rpcEndpoints[endpointId];
        require(!endpoint.isHealthy, "Endpoint already healthy");
        
        uint256 downtime = block.timestamp - endpoint.lastFailure;
        endpoint.isHealthy = true;
        endpoint.responseTime = 100; // Reset to normal
        endpoint.errorRate = 0;
        
        emit RPCEndpointRecovered(endpointId, downtime);
    }

    // Oracle node failure simulation
    function registerOracleNode(address nodeAddress) external onlyRole(FAILURE_ADMIN_ROLE) {
        OracleNode storage node = oracleNodes[nodeAddress];
        node.nodeAddress = nodeAddress;
        node.isOnline = true;
        node.isSynced = true;
        node.lastHeartbeat = block.timestamp;
        node.latency = 50; // Default 50ms
        node.hasCorruptedData = false;
        node.corruptionPercent = 0;
    }

    function simulateOracleFailure(address nodeAddress, bool offline, bool corrupted, uint256 corruptionPercent) 
        external onlyRole(FAILURE_ADMIN_ROLE) 
    {
        OracleNode storage node = oracleNodes[nodeAddress];
        if (offline) {
            node.isOnline = false;
            node.isSynced = false;
        }
        if (corrupted) {
            node.hasCorruptedData = true;
            node.corruptionPercent = corruptionPercent;
            emit OracleNodeCorrupted(nodeAddress, corruptionPercent);
        }
    }

    function recoverOracleNode(address nodeAddress) external onlyRole(OPERATOR_ROLE) {
        OracleNode storage node = oracleNodes[nodeAddress];
        node.isOnline = true;
        node.isSynced = true;
        node.hasCorruptedData = false;
        node.corruptionPercent = 0;
        node.lastHeartbeat = block.timestamp;
        emit OracleNodeRecovered(nodeAddress);
    }

    // Validator set corruption simulation
    function initializeValidatorSet(uint256 chainId, address[] calldata validators, uint256 minimumRequired) 
        external onlyRole(FAILURE_ADMIN_ROLE) 
    {
        ValidatorSet storage valSet = validatorSets[chainId];
        valSet.totalValidators = validators.length;
        valSet.minimumRequired = minimumRequired;
        valSet.corruptedCount = 0;
        
        // Clear existing
        for (uint256 i = 0; i < valSet.activeValidators.length; i++) {
            delete valSet.isValidator[valSet.activeValidators[i]];
            delete valSet.isCorrupted[valSet.activeValidators[i]];
            delete valSet.lastActivity[valSet.activeValidators[i]];
        }
        delete valSet.activeValidators;
        
        // Set new validators
        for (uint256 i = 0; i < validators.length; i++) {
            valSet.isValidator[validators[i]] = true;
            valSet.lastActivity[validators[i]] = block.timestamp;
            valSet.activeValidators.push(validators[i]);
        }
    }

    function simulateValidatorCorruption(uint256 chainId, address[] calldata corruptedValidators) 
        external onlyRole(FAILURE_ADMIN_ROLE) 
    {
        ValidatorSet storage valSet = validatorSets[chainId];
        uint256 newCorrupted = 0;
        
        for (uint256 i = 0; i < corruptedValidators.length; i++) {
            if (valSet.isValidator[corruptedValidators[i]] && !valSet.isCorrupted[corruptedValidators[i]]) {
                valSet.isCorrupted[corruptedValidators[i]] = true;
                newCorrupted++;
            }
        }
        
        valSet.corruptedCount += newCorrupted;
        emit ValidatorSetCorrupted(chainId, valSet.corruptedCount);
    }

    function recoverValidatorSet(uint256 chainId) external onlyRole(OPERATOR_ROLE) {
        ValidatorSet storage valSet = validatorSets[chainId];
        
        // Reset all corruption
        for (uint256 i = 0; i < valSet.activeValidators.length; i++) {
            valSet.isCorrupted[valSet.activeValidators[i]] = false;
            valSet.lastActivity[valSet.activeValidators[i]] = block.timestamp;
        }
        valSet.corruptedCount = 0;
        
        emit ValidatorSetRecovered(chainId);
    }

    // Bridge module failure simulation
    function simulateBridgeFailure(uint256 protocol, bytes32 messageId) external onlyRole(FAILURE_ADMIN_ROLE) {
        bridgeFailures[protocol][messageId] = true;
        protocolStatus[protocol] = false;
        emit BridgeModuleFailure(protocol, messageId);
    }

    function simulateProtocolFailure(uint256 protocol, uint256 errorRate, uint256 latency) 
        external onlyRole(FAILURE_ADMIN_ROLE) 
    {
        protocolStatus[protocol] = false;
        protocolErrorRate[protocol] = errorRate;
        protocolLatency[protocol] = latency;
    }

    function recoverBridgeProtocol(uint256 protocol) external onlyRole(OPERATOR_ROLE) {
        protocolStatus[protocol] = true;
        protocolErrorRate[protocol] = 0;
        protocolLatency[protocol] = 0;
        emit BridgeModuleRecovered(protocol);
    }

    // Multi-region coordination failure
    function registerRegion(bytes32 regionId, string calldata name, uint256[] calldata supportedChains) 
        external onlyRole(FAILURE_ADMIN_ROLE) 
    {
        Region storage region = regions[regionId];
        region.name = name;
        region.isOnline = true;
        region.lastSync = block.timestamp;
        region.supportedChains = supportedChains;
        
        for (uint256 i = 0; i < supportedChains.length; i++) {
            region.chainSyncStatus[supportedChains[i]] = true;
        }
        
        regionList.push(regionId);
    }

    function simulateRegionFailure(bytes32 regionId, uint256[] calldata affectedChains) 
        external onlyRole(FAILURE_ADMIN_ROLE) 
    {
        Region storage region = regions[regionId];
        region.isOnline = false;
        
        for (uint256 i = 0; i < affectedChains.length; i++) {
            region.chainSyncStatus[affectedChains[i]] = false;
        }
        
        emit RegionCoordinationFailure(regionId, affectedChains);
    }

    function recoverRegion(bytes32 regionId) external onlyRole(OPERATOR_ROLE) {
        Region storage region = regions[regionId];
        region.isOnline = true;
        region.lastSync = block.timestamp;
        
        for (uint256 i = 0; i < region.supportedChains.length; i++) {
            region.chainSyncStatus[region.supportedChains[i]] = true;
        }
        
        emit RegionCoordinationRecovered(regionId);
    }

    // Emergency migration procedures
    function initiateEmergencyMigration(
        bytes32 migrationId,
        string calldata fromSystem,
        string calldata toSystem,
        uint256 rto,
        uint256 rpo
    ) external onlyRole(FAILURE_ADMIN_ROLE) {
        RecoveryMetrics storage metrics = recoveryMetrics[migrationId];
        metrics.recoveryStartTime = block.timestamp;
        metrics.rto = rto;
        metrics.rpo = rpo;
        metrics.isRecovering = true;
        metrics.failureType = "emergency_migration";
        metrics.recoveryProcedureId = migrationId;
        
        emit EmergencyMigrationInitiated(migrationId, fromSystem, toSystem);
        emit RecoveryProcedureStarted(migrationId, "emergency_migration", rto, rpo);
    }

    function completeEmergencyMigration(bytes32 migrationId) external onlyRole(OPERATOR_ROLE) {
        RecoveryMetrics storage metrics = recoveryMetrics[migrationId];
        require(metrics.isRecovering, "Migration not in progress");
        
        metrics.recoveryEndTime = block.timestamp;
        metrics.isRecovering = false;
        
        uint256 actualRecoveryTime = metrics.recoveryEndTime - metrics.recoveryStartTime;
        
        emit EmergencyMigrationCompleted(migrationId, actualRecoveryTime);
        emit RecoveryProcedureCompleted(migrationId, actualRecoveryTime);
    }

    // Recovery procedure tracking
    function startRecoveryProcedure(
        bytes32 procedureId,
        string calldata failureType,
        uint256 rto,
        uint256 rpo
    ) external onlyRole(OPERATOR_ROLE) {
        RecoveryMetrics storage metrics = recoveryMetrics[procedureId];
        metrics.recoveryStartTime = block.timestamp;
        metrics.rto = rto;
        metrics.rpo = rpo;
        metrics.isRecovering = true;
        metrics.failureType = failureType;
        metrics.recoveryProcedureId = procedureId;
        
        emit RecoveryProcedureStarted(procedureId, failureType, rto, rpo);
    }

    function completeRecoveryProcedure(bytes32 procedureId) external onlyRole(OPERATOR_ROLE) {
        RecoveryMetrics storage metrics = recoveryMetrics[procedureId];
        require(metrics.isRecovering, "Recovery not in progress");
        
        metrics.recoveryEndTime = block.timestamp;
        metrics.isRecovering = false;
        
        uint256 actualRecoveryTime = metrics.recoveryEndTime - metrics.recoveryStartTime;
        
        emit RecoveryProcedureCompleted(procedureId, actualRecoveryTime);
    }

    // Query functions
    function isNetworkPartitioned(uint256 chainId) external view returns (bool) {
        return networkConditions[chainId].isPartitioned;
    }

    function isRPCHealthy(bytes32 endpointId) external view returns (bool) {
        return rpcEndpoints[endpointId].isHealthy;
    }

    function isOracleHealthy(address nodeAddress) external view returns (bool) {
        OracleNode storage node = oracleNodes[nodeAddress];
        return node.isOnline && node.isSynced && !node.hasCorruptedData;
    }

    function isProtocolHealthy(uint256 protocol) external view returns (bool) {
        return protocolStatus[protocol];
    }

    function isRegionOnline(bytes32 regionId) external view returns (bool) {
        return regions[regionId].isOnline;
    }

    function getValidatorSetHealth(uint256 chainId) external view returns (uint256 total, uint256 corrupted, uint256 minimum) {
        ValidatorSet storage valSet = validatorSets[chainId];
        return (valSet.totalValidators, valSet.corruptedCount, valSet.minimumRequired);
    }

    function getRecoveryMetrics(bytes32 procedureId) external view returns (
        uint256 startTime,
        uint256 endTime,
        uint256 rto,
        uint256 rpo,
        bool isRecovering,
        string memory failureType
    ) {
        RecoveryMetrics storage metrics = recoveryMetrics[procedureId];
        return (
            metrics.recoveryStartTime,
            metrics.recoveryEndTime,
            metrics.rto,
            metrics.rpo,
            metrics.isRecovering,
            metrics.failureType
        );
    }

    function hasMessageFailed(uint256 protocol, bytes32 messageId) external view returns (bool) {
        return bridgeFailures[protocol][messageId];
    }

    function getNetworkConditions(uint256 chainId) external view returns (NetworkConditions memory) {
        return networkConditions[chainId];
    }

    function getRPCEndpoint(bytes32 endpointId) external view returns (RPCEndpoint memory) {
        return rpcEndpoints[endpointId];
    }

    function getOracleNode(address nodeAddress) external view returns (OracleNode memory) {
        return oracleNodes[nodeAddress];
    }

    // Emergency pause for catastrophic failures
    function emergencyPause() external onlyRole(FAILURE_ADMIN_ROLE) {
        _pause();
    }

    function emergencyUnpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}