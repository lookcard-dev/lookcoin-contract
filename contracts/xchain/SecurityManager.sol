// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/ICrossChainRouter.sol";
import "../security/RateLimiter.sol";

contract SecurityManager is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    UUPSUpgradeable,
    RateLimiter 
{
    bytes32 public constant SECURITY_ADMIN_ROLE = keccak256("SECURITY_ADMIN_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    struct ProtocolSecurityConfig {
        bool paused;
        uint256 dailyLimit;
        uint256 transactionLimit;
        uint256 cooldownPeriod;
    }

    struct AnomalyThreshold {
        uint256 volumeThreshold;
        uint256 frequencyThreshold;
        uint256 timeWindow;
    }

    mapping(ICrossChainRouter.Protocol => ProtocolSecurityConfig) public protocolConfigs;
    mapping(ICrossChainRouter.Protocol => bool) public protocolPaused;
    mapping(address => mapping(ICrossChainRouter.Protocol => uint256)) public userProtocolVolume;
    mapping(address => uint256) public suspiciousActivityCount;
    
    AnomalyThreshold public anomalyThreshold;
    uint256 public globalDailyLimit;
    uint256 public globalDailyVolume;
    uint256 public lastResetTime;
    
    bool public emergencyPaused;
    mapping(bytes32 => bool) public blockedTransfers;

    uint256[50] private __gap;

    event ProtocolPaused(ICrossChainRouter.Protocol indexed protocol);
    event ProtocolUnpaused(ICrossChainRouter.Protocol indexed protocol);
    event EmergencyPauseActivated();
    event EmergencyPauseDeactivated();
    event AnomalyDetected(address indexed user, ICrossChainRouter.Protocol protocol, string reason);
    event TransferBlocked(bytes32 indexed transferId);
    event SecurityConfigUpdated(ICrossChainRouter.Protocol indexed protocol);
    event GlobalLimitUpdated(uint256 newLimit);

    function initialize(
        address _admin,
        uint256 _globalDailyLimit
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        __RateLimiter_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SECURITY_ADMIN_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);

        globalDailyLimit = _globalDailyLimit;
        lastResetTime = block.timestamp;

        // Set default anomaly thresholds
        anomalyThreshold = AnomalyThreshold({
            volumeThreshold: 1000000 * 10**18, // 1M tokens
            frequencyThreshold: 10, // 10 transactions
            timeWindow: 1 hours
        });

        // Set default protocol configs
        for (uint8 i = 0; i < 4; i++) {
            ICrossChainRouter.Protocol protocol = ICrossChainRouter.Protocol(i);
            protocolConfigs[protocol] = ProtocolSecurityConfig({
                paused: false,
                dailyLimit: 500000 * 10**18, // 500K tokens
                transactionLimit: 50000 * 10**18, // 50K tokens per tx
                cooldownPeriod: 5 minutes
            });
        }
    }

    function validateTransfer(
        address user,
        ICrossChainRouter.Protocol protocol,
        uint256 amount,
        bytes32 transferId
    ) external whenNotPaused returns (bool) {
        require(!emergencyPaused, "Emergency pause active");
        require(!protocolPaused[protocol], "Protocol paused");
        require(!blockedTransfers[transferId], "Transfer blocked");

        // Check global daily limit
        if (block.timestamp >= lastResetTime + 1 days) {
            globalDailyVolume = 0;
            lastResetTime = block.timestamp;
        }
        require(globalDailyVolume + amount <= globalDailyLimit, "Global daily limit exceeded");

        // Check protocol limits
        ProtocolSecurityConfig memory config = protocolConfigs[protocol];
        require(amount <= config.transactionLimit, "Transaction limit exceeded");

        // Check rate limiting
        _checkRateLimit(user, amount);

        // Update volumes
        globalDailyVolume += amount;
        userProtocolVolume[user][protocol] += amount;

        // Check for anomalies
        _checkForAnomalies(user, protocol, amount);

        return true;
    }

    function pauseProtocol(ICrossChainRouter.Protocol protocol) external onlyRole(SECURITY_ADMIN_ROLE) {
        protocolPaused[protocol] = true;
        emit ProtocolPaused(protocol);
    }

    function unpauseProtocol(ICrossChainRouter.Protocol protocol) external onlyRole(SECURITY_ADMIN_ROLE) {
        protocolPaused[protocol] = false;
        emit ProtocolUnpaused(protocol);
    }

    function activateEmergencyPause() external onlyRole(EMERGENCY_ROLE) {
        emergencyPaused = true;
        emit EmergencyPauseActivated();
    }

    function deactivateEmergencyPause() external onlyRole(EMERGENCY_ROLE) {
        emergencyPaused = false;
        emit EmergencyPauseDeactivated();
    }

    function blockTransfer(bytes32 transferId) external onlyRole(SECURITY_ADMIN_ROLE) {
        blockedTransfers[transferId] = true;
        emit TransferBlocked(transferId);
    }

    function updateProtocolConfig(
        ICrossChainRouter.Protocol protocol,
        uint256 dailyLimit,
        uint256 transactionLimit,
        uint256 cooldownPeriod
    ) external onlyRole(SECURITY_ADMIN_ROLE) {
        protocolConfigs[protocol] = ProtocolSecurityConfig({
            paused: protocolConfigs[protocol].paused,
            dailyLimit: dailyLimit,
            transactionLimit: transactionLimit,
            cooldownPeriod: cooldownPeriod
        });
        emit SecurityConfigUpdated(protocol);
    }

    function updateGlobalDailyLimit(uint256 newLimit) external onlyRole(SECURITY_ADMIN_ROLE) {
        globalDailyLimit = newLimit;
        emit GlobalLimitUpdated(newLimit);
    }

    function updateAnomalyThreshold(
        uint256 volumeThreshold,
        uint256 frequencyThreshold,
        uint256 timeWindow
    ) external onlyRole(SECURITY_ADMIN_ROLE) {
        anomalyThreshold = AnomalyThreshold({
            volumeThreshold: volumeThreshold,
            frequencyThreshold: frequencyThreshold,
            timeWindow: timeWindow
        });
    }

    function reportSuspiciousActivity(address user) external onlyRole(SECURITY_ADMIN_ROLE) {
        suspiciousActivityCount[user]++;
    }

    function clearSuspiciousActivity(address user) external onlyRole(SECURITY_ADMIN_ROLE) {
        suspiciousActivityCount[user] = 0;
    }

    function _checkForAnomalies(
        address user,
        ICrossChainRouter.Protocol protocol,
        uint256 amount
    ) private {
        // Check volume anomaly
        if (userProtocolVolume[user][protocol] > anomalyThreshold.volumeThreshold) {
            emit AnomalyDetected(user, protocol, "High volume");
            suspiciousActivityCount[user]++;
        }

        // Check if user has too many suspicious activities
        if (suspiciousActivityCount[user] > 5) {
            revert("User flagged for suspicious activity");
        }
    }

    function pause() external onlyRole(SECURITY_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(SECURITY_ADMIN_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}