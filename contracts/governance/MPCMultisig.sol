// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title MPCMultisig
 * @dev MPC multisig governance system with 3-of-5 threshold and timelock mechanisms
 */
contract MPCMultisig is AccessControlUpgradeable {
    using ECDSA for bytes32;

    // Role definitions
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    // Timelock durations
    uint256 public constant STANDARD_TIMELOCK = 48 hours;
    uint256 public constant EMERGENCY_TIMELOCK = 2 hours;
    uint256 public constant IMMEDIATE_EXECUTION = 0;

    // Transaction types
    enum TxType {
        STANDARD,          // 48-hour timelock
        EMERGENCY,         // 2-hour timelock
        IMMEDIATE_PAUSE    // No timelock for emergency pause
    }

    // Transaction structure
    struct Transaction {
        address target;
        uint256 value;
        bytes data;
        TxType txType;
        uint256 proposedAt;
        uint256 executionTime;
        bool executed;
        address proposer;
        uint256 signatureCount;
        mapping(address => bool) signatures;
    }

    // State variables
    uint256 public threshold = 3;
    uint256 public signerCount = 5;
    uint256 public transactionCount;
    mapping(uint256 => Transaction) public transactions;
    
    // Key management
    struct KeyRotation {
        address oldSigner;
        address newSigner;
        uint256 scheduledAt;
        uint256 executionTime;
        bool executed;
        uint256 signatureCount;
        mapping(address => bool) signatures;
    }
    
    uint256 public keyRotationCount;
    mapping(uint256 => KeyRotation) public keyRotations;
    uint256 public constant KEY_ROTATION_DELAY = 7 days;
    uint256 public lastKeyRotation;
    uint256 public constant QUARTERLY_ROTATION = 90 days;
    
    // Nonce management for replay protection
    mapping(address => uint256) public nonces;
    
    // Events
    event TransactionProposed(
        uint256 indexed txId,
        address indexed proposer,
        address target,
        uint256 value,
        TxType txType
    );
    event TransactionSigned(uint256 indexed txId, address indexed signer);
    event TransactionExecuted(uint256 indexed txId, address indexed executor);
    event TransactionCancelled(uint256 indexed txId);
    event KeyRotationProposed(
        uint256 indexed rotationId,
        address indexed oldSigner,
        address indexed newSigner
    );
    event KeyRotationExecuted(
        uint256 indexed rotationId,
        address indexed oldSigner,
        address indexed newSigner
    );
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    /**
     * @dev Initialize the MPC multisig
     * @param _signers Initial signer addresses
     * @param _admin Admin address
     */
    function initialize(
        address[] memory _signers,
        address _admin
    ) public initializer {
        __AccessControl_init();
        
        require(_signers.length == 5, "MPCMultisig: must have 5 signers");
        require(_admin != address(0), "MPCMultisig: invalid admin");
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(EXECUTOR_ROLE, _admin);
        
        for (uint i = 0; i < _signers.length; i++) {
            require(_signers[i] != address(0), "MPCMultisig: invalid signer");
            _grantRole(SIGNER_ROLE, _signers[i]);
        }
        
        lastKeyRotation = block.timestamp;
    }

    /**
     * @dev Propose a new transaction
     * @param _target Target contract address
     * @param _value ETH value to send
     * @param _data Transaction data
     * @param _txType Transaction type
     * @return txId Transaction ID
     */
    function proposeTransaction(
        address _target,
        uint256 _value,
        bytes calldata _data,
        TxType _txType
    ) external onlyRole(SIGNER_ROLE) returns (uint256 txId) {
        require(_target != address(0), "MPCMultisig: invalid target");
        
        txId = transactionCount++;
        Transaction storage transaction = transactions[txId];
        
        transaction.target = _target;
        transaction.value = _value;
        transaction.data = _data;
        transaction.txType = _txType;
        transaction.proposedAt = block.timestamp;
        transaction.proposer = msg.sender;
        transaction.signatureCount = 1;
        transaction.signatures[msg.sender] = true;
        
        // Set execution time based on type
        if (_txType == TxType.STANDARD) {
            transaction.executionTime = block.timestamp + STANDARD_TIMELOCK;
        } else if (_txType == TxType.EMERGENCY) {
            transaction.executionTime = block.timestamp + EMERGENCY_TIMELOCK;
        } else {
            transaction.executionTime = block.timestamp; // Immediate execution
        }
        
        emit TransactionProposed(txId, msg.sender, _target, _value, _txType);
    }

    /**
     * @dev Sign a proposed transaction
     * @param _txId Transaction ID
     */
    function signTransaction(uint256 _txId) external onlyRole(SIGNER_ROLE) {
        Transaction storage transaction = transactions[_txId];
        require(transaction.proposedAt > 0, "MPCMultisig: transaction not found");
        require(!transaction.executed, "MPCMultisig: already executed");
        require(!transaction.signatures[msg.sender], "MPCMultisig: already signed");
        
        transaction.signatures[msg.sender] = true;
        transaction.signatureCount++;
        
        emit TransactionSigned(_txId, msg.sender);
    }

    /**
     * @dev Execute a transaction after threshold and timelock
     * @param _txId Transaction ID
     */
    function executeTransaction(uint256 _txId) external onlyRole(EXECUTOR_ROLE) {
        Transaction storage transaction = transactions[_txId];
        require(transaction.proposedAt > 0, "MPCMultisig: transaction not found");
        require(!transaction.executed, "MPCMultisig: already executed");
        require(transaction.signatureCount >= threshold, "MPCMultisig: insufficient signatures");
        require(block.timestamp >= transaction.executionTime, "MPCMultisig: timelock not expired");
        
        transaction.executed = true;
        
        // Execute transaction
        (bool success, ) = transaction.target.call{value: transaction.value}(transaction.data);
        require(success, "MPCMultisig: execution failed");
        
        emit TransactionExecuted(_txId, msg.sender);
    }

    /**
     * @dev Cancel a pending transaction
     * @param _txId Transaction ID
     */
    function cancelTransaction(uint256 _txId) external onlyRole(SIGNER_ROLE) {
        Transaction storage transaction = transactions[_txId];
        require(transaction.proposedAt > 0, "MPCMultisig: transaction not found");
        require(!transaction.executed, "MPCMultisig: already executed");
        require(transaction.proposer == msg.sender, "MPCMultisig: only proposer can cancel");
        
        transaction.executed = true; // Mark as executed to prevent future execution
        
        emit TransactionCancelled(_txId);
    }

    /**
     * @dev Propose key rotation
     * @param _oldSigner Address to remove
     * @param _newSigner Address to add
     * @return rotationId Rotation ID
     */
    function proposeKeyRotation(
        address _oldSigner,
        address _newSigner
    ) external onlyRole(SIGNER_ROLE) returns (uint256 rotationId) {
        require(hasRole(SIGNER_ROLE, _oldSigner), "MPCMultisig: not a signer");
        require(!hasRole(SIGNER_ROLE, _newSigner), "MPCMultisig: already a signer");
        require(_newSigner != address(0), "MPCMultisig: invalid new signer");
        
        rotationId = keyRotationCount++;
        KeyRotation storage rotation = keyRotations[rotationId];
        
        rotation.oldSigner = _oldSigner;
        rotation.newSigner = _newSigner;
        rotation.scheduledAt = block.timestamp;
        rotation.executionTime = block.timestamp + KEY_ROTATION_DELAY;
        rotation.signatureCount = 1;
        rotation.signatures[msg.sender] = true;
        
        emit KeyRotationProposed(rotationId, _oldSigner, _newSigner);
    }

    /**
     * @dev Sign key rotation
     * @param _rotationId Rotation ID
     */
    function signKeyRotation(uint256 _rotationId) external onlyRole(SIGNER_ROLE) {
        KeyRotation storage rotation = keyRotations[_rotationId];
        require(rotation.scheduledAt > 0, "MPCMultisig: rotation not found");
        require(!rotation.executed, "MPCMultisig: already executed");
        require(!rotation.signatures[msg.sender], "MPCMultisig: already signed");
        
        rotation.signatures[msg.sender] = true;
        rotation.signatureCount++;
    }

    /**
     * @dev Execute key rotation
     * @param _rotationId Rotation ID
     */
    function executeKeyRotation(uint256 _rotationId) external onlyRole(EXECUTOR_ROLE) {
        KeyRotation storage rotation = keyRotations[_rotationId];
        require(rotation.scheduledAt > 0, "MPCMultisig: rotation not found");
        require(!rotation.executed, "MPCMultisig: already executed");
        require(rotation.signatureCount >= threshold, "MPCMultisig: insufficient signatures");
        require(block.timestamp >= rotation.executionTime, "MPCMultisig: timelock not expired");
        
        rotation.executed = true;
        
        // Rotate keys
        _revokeRole(SIGNER_ROLE, rotation.oldSigner);
        _grantRole(SIGNER_ROLE, rotation.newSigner);
        
        lastKeyRotation = block.timestamp;
        
        emit KeyRotationExecuted(_rotationId, rotation.oldSigner, rotation.newSigner);
    }

    /**
     * @dev Check if quarterly rotation is due
     * @return isDue Whether rotation is due
     */
    function isQuarterlyRotationDue() external view returns (bool isDue) {
        return block.timestamp >= lastKeyRotation + QUARTERLY_ROTATION;
    }

    /**
     * @dev Update threshold (requires multisig)
     * @param _newThreshold New threshold value
     */
    function updateThreshold(uint256 _newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newThreshold > 0 && _newThreshold <= signerCount, "MPCMultisig: invalid threshold");
        require(_newThreshold >= 3, "MPCMultisig: threshold too low"); // Minimum 3-of-5
        
        uint256 oldThreshold = threshold;
        threshold = _newThreshold;
        
        emit ThresholdUpdated(oldThreshold, _newThreshold);
    }

    /**
     * @dev Get transaction details
     * @param _txId Transaction ID
     * @return target Target address
     * @return value ETH value
     * @return data Transaction data
     * @return txType Transaction type
     * @return executionTime Execution time
     * @return executed Execution status
     * @return signatureCount Number of signatures
     */
    function getTransaction(uint256 _txId) external view returns (
        address target,
        uint256 value,
        bytes memory data,
        TxType txType,
        uint256 executionTime,
        bool executed,
        uint256 signatureCount
    ) {
        Transaction storage transaction = transactions[_txId];
        return (
            transaction.target,
            transaction.value,
            transaction.data,
            transaction.txType,
            transaction.executionTime,
            transaction.executed,
            transaction.signatureCount
        );
    }

    /**
     * @dev Check if address has signed transaction
     * @param _txId Transaction ID
     * @param _signer Signer address
     * @return hasSigned Whether signer has signed
     */
    function hasSignedTransaction(
        uint256 _txId,
        address _signer
    ) external view returns (bool hasSigned) {
        return transactions[_txId].signatures[_signer];
    }

    /**
     * @dev Get current signers count
     * @return count Number of signers
     */
    function getSignersCount() external view returns (uint256 count) {
        return signerCount;
    }

    /**
     * @dev Emergency pause helper function
     * @param _targets Array of contracts to pause
     */
    function emergencyPauseContracts(address[] calldata _targets) external onlyRole(SIGNER_ROLE) {
        for (uint i = 0; i < _targets.length; i++) {
            bytes memory pauseData = abi.encodeWithSignature("pause()");
            uint256 txId = this.proposeTransaction(_targets[i], 0, pauseData, TxType.IMMEDIATE_PAUSE);
            // Auto-execute if threshold met
            if (transactions[txId].signatureCount >= threshold) {
                this.executeTransaction(txId);
            }
        }
    }
}