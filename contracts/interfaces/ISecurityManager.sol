// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ISecurityManager
 * @dev Interface for the SecurityManager contract
 * @notice Manages security features including MEV protection, attack detection, and emergency responses
 */
interface ISecurityManager {
    // Security status struct
    struct SecurityStatus {
        bool allProtectionsActive;
        bool mevProtectionEnabled;
        bool reentrancyGuardActive;
        bool emergencyPauseEnabled;
        uint256 lastSecurityIncident;
    }

    // Events
    event SecurityIncidentDetected(address attacker, string attackType);
    event EmergencyPauseActivated(address triggeredBy);
    event SecurityStatusUpdated(bool protectionsActive);

    // Core functions
    function getSecurityStatus() external view returns (SecurityStatus memory);
    function detectAndPreventAttack(address sender, bytes calldata data) external returns (bool);
    function activateEmergencyPause() external;
    function deactivateEmergencyPause() external;
    
    // MEV Protection
    function checkMEVProtection(address sender, uint256 amount) external view returns (bool);
    function reportMEVAttempt(address attacker, uint256 extractedValue) external;
    
    // Attack Detection
    function isBlacklisted(address account) external view returns (bool);
    function addToBlacklist(address account) external;
    function removeFromBlacklist(address account) external;
    
    // Custom errors
    error FrontRunningDetected();
    error ArbitrageWindowClosed();
    error FlashLoanArbitrageDetected();
    error CoordinatedAttackDetected();
    error RaceConditionPrevented();
    error FailoverExploitPrevented();
    error BridgeCyclingDetected();
    error StateInconsistencyDetected();
    error JITLiquidityDetected();
    error AtomicArbitrageBlocked();
    error GeneralizedFrontRunBlocked();
    error ComplexAttackDetected();
    error ParallelAttackDetected();
    error TimeManipulationDetected();
}