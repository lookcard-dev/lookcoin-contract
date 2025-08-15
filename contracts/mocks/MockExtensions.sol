// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MockSupplyOracleExtensions
 * @dev Extensions for SupplyOracle to support comprehensive testing
 */
abstract contract MockSupplyOracleExtensions is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    // Checkpoint management
    struct StateCheckpoint {
        uint256 timestamp;
        bytes32 stateHash;
        uint256 totalSupply;
        uint256 blockNumber;
    }
    
    mapping(uint256 => StateCheckpoint) public checkpoints;
    uint256 public checkpointCounter;
    
    // Supply report structure
    struct SupplyReport {
        uint32 chainId;
        uint256 totalSupply;
        uint256 lockedSupply;
        uint256 timestamp;
        address reporter;
    }
    
    mapping(uint256 => SupplyReport) public supplyReports;
    uint256 public reportCounter;
    
    // Transaction validation
    mapping(bytes32 => bool) public validatedTransactions;
    
    event CheckpointCreated(uint256 indexed checkpointId, bytes32 stateHash);
    event SupplyReportSubmitted(uint256 indexed reportId, uint32 chainId, uint256 totalSupply);
    event TransactionValidated(bytes32 indexed txHash, bool isValid);
    
    /**
     * @dev Submit a supply report for a specific chain
     */
    function submitSupplyReport(
        uint32 _chainId,
        uint256 _totalSupply,
        uint256 _lockedSupply
    ) external onlyRole(ORACLE_ROLE) returns (uint256 reportId) {
        reportId = ++reportCounter;
        supplyReports[reportId] = SupplyReport({
            chainId: _chainId,
            totalSupply: _totalSupply,
            lockedSupply: _lockedSupply,
            timestamp: block.timestamp,
            reporter: msg.sender
        });
        
        emit SupplyReportSubmitted(reportId, _chainId, _totalSupply);
    }
    
    /**
     * @dev Create a state checkpoint for rollback scenarios
     */
    function createStateCheckpoint() external onlyRole(ORACLE_ROLE) returns (uint256 checkpointId) {
        checkpointId = ++checkpointCounter;
        
        bytes32 stateHash = keccak256(abi.encodePacked(
            block.timestamp,
            block.number,
            msg.sender
        ));
        
        checkpoints[checkpointId] = StateCheckpoint({
            timestamp: block.timestamp,
            stateHash: stateHash,
            totalSupply: 0, // Would be fetched from actual state
            blockNumber: block.number
        });
        
        emit CheckpointCreated(checkpointId, stateHash);
    }
    
    /**
     * @dev Validate a transaction for cross-chain consistency
     */
    function validateTransaction(bytes32 _txHash) external onlyRole(ORACLE_ROLE) returns (bool) {
        bool isValid = _txHash != bytes32(0);
        validatedTransactions[_txHash] = isValid;
        emit TransactionValidated(_txHash, isValid);
        return isValid;
    }
}

/**
 * @title MockCrossChainRouterExtensions
 * @dev Extensions for CrossChainRouter to support advanced testing scenarios
 */
abstract contract MockCrossChainRouterExtensions is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    // Atomic swap state
    struct AtomicSwap {
        address initiator;
        address recipient;
        uint256 amount;
        uint32 sourceChain;
        uint32 targetChain;
        bytes32 secretHash;
        uint256 deadline;
        bool completed;
    }
    
    mapping(bytes32 => AtomicSwap) public atomicSwaps;
    bool public strictOrdering;
    address public protocolRegistry;
    
    // Multi-chain transfer tracking
    struct MultiChainTransfer {
        address sender;
        uint256 totalAmount;
        uint32[] targetChains;
        uint256[] amounts;
        bool completed;
    }
    
    mapping(bytes32 => MultiChainTransfer) public multiChainTransfers;
    
    // Cross-chain transaction preparation
    struct PreparedTransaction {
        address sender;
        uint32 targetChain;
        uint256 amount;
        bytes data;
        uint256 estimatedFee;
        bool prepared;
    }
    
    mapping(bytes32 => PreparedTransaction) public preparedTransactions;
    
    event StrictOrderingSet(bool enabled);
    event AtomicSwapInitiated(bytes32 indexed swapId, address initiator, uint256 amount);
    event MultiChainTransferInitiated(bytes32 indexed transferId, uint256 totalAmount);
    event TransactionPrepared(bytes32 indexed txId, uint32 targetChain, uint256 amount);
    event ProtocolRegistrySet(address registry);
    
    /**
     * @dev Set strict ordering for cross-chain messages
     */
    function setStrictOrdering(bool _enabled) external onlyRole(OPERATOR_ROLE) {
        strictOrdering = _enabled;
        emit StrictOrderingSet(_enabled);
    }
    
    /**
     * @dev Initiate an atomic swap
     */
    function initiateAtomicSwap(
        address _recipient,
        uint256 _amount,
        uint32 _targetChain,
        bytes32 _secretHash,
        uint256 _deadline
    ) external returns (bytes32 swapId) {
        swapId = keccak256(abi.encodePacked(
            msg.sender,
            _recipient,
            _amount,
            _targetChain,
            _secretHash,
            block.timestamp
        ));
        
        atomicSwaps[swapId] = AtomicSwap({
            initiator: msg.sender,
            recipient: _recipient,
            amount: _amount,
            sourceChain: uint32(block.chainid),
            targetChain: _targetChain,
            secretHash: _secretHash,
            deadline: _deadline,
            completed: false
        });
        
        emit AtomicSwapInitiated(swapId, msg.sender, _amount);
    }
    
    /**
     * @dev Initiate a multi-chain transfer
     */
    function initiateMultiChainTransfer(
        uint32[] calldata _targetChains,
        uint256[] calldata _amounts
    ) external returns (bytes32 transferId) {
        require(_targetChains.length == _amounts.length, "Length mismatch");
        
        uint256 totalAmount;
        for (uint256 i = 0; i < _amounts.length; i++) {
            totalAmount += _amounts[i];
        }
        
        transferId = keccak256(abi.encodePacked(
            msg.sender,
            _targetChains,
            _amounts,
            block.timestamp
        ));
        
        multiChainTransfers[transferId] = MultiChainTransfer({
            sender: msg.sender,
            totalAmount: totalAmount,
            targetChains: _targetChains,
            amounts: _amounts,
            completed: false
        });
        
        emit MultiChainTransferInitiated(transferId, totalAmount);
    }
    
    /**
     * @dev Prepare a cross-chain transaction
     */
    function prepareCrossChainTransaction(
        uint32 _targetChain,
        uint256 _amount,
        bytes calldata _data
    ) external returns (bytes32 txId) {
        txId = keccak256(abi.encodePacked(
            msg.sender,
            _targetChain,
            _amount,
            _data,
            block.timestamp
        ));
        
        preparedTransactions[txId] = PreparedTransaction({
            sender: msg.sender,
            targetChain: _targetChain,
            amount: _amount,
            data: _data,
            estimatedFee: 0.01 ether, // Mock fee
            prepared: true
        });
        
        emit TransactionPrepared(txId, _targetChain, _amount);
    }
    
    /**
     * @dev Estimate bridge fee for a transfer
     */
    function estimateBridgeFee(
        uint32 _targetChain,
        uint256 _amount,
        uint8 _protocol
    ) external pure returns (uint256) {
        // Mock fee calculation
        uint256 baseFee = 0.01 ether;
        if (_protocol == 1) { // Celer
            baseFee += (_amount * 5) / 1000; // 0.5% fee
        }
        return baseFee;
    }
    
    /**
     * @dev Set the protocol registry address
     */
    function setProtocolRegistry(address _registry) external onlyRole(OPERATOR_ROLE) {
        protocolRegistry = _registry;
        emit ProtocolRegistrySet(_registry);
    }
}

/**
 * @title MockBridgeModuleExtensions
 * @dev Extensions for bridge modules to support testing
 */
abstract contract MockBridgeModuleExtensions {
    // Fee parameters
    struct FeeParameters {
        uint256 baseFee;
        uint256 percentageFee;
        uint256 minFee;
        uint256 maxFee;
    }
    
    FeeParameters public feeParameters;
    
    // Nonce tracking
    mapping(uint32 => uint256) public outboundNonces;
    
    event FeeParametersSet(uint256 baseFee, uint256 percentageFee);
    
    /**
     * @dev Set fee parameters for the bridge
     */
    function setFeeParameters(
        uint256 _baseFee,
        uint256 _percentageFee,
        uint256 _minFee,
        uint256 _maxFee
    ) external {
        feeParameters = FeeParameters({
            baseFee: _baseFee,
            percentageFee: _percentageFee,
            minFee: _minFee,
            maxFee: _maxFee
        });
        
        emit FeeParametersSet(_baseFee, _percentageFee);
    }
    
    /**
     * @dev Get the current outbound nonce for a destination
     */
    function getOutboundNonce(uint32 _dstChainId) external view returns (uint256) {
        return outboundNonces[_dstChainId];
    }
    
    /**
     * @dev Internal function to increment nonce
     */
    function _incrementNonce(uint32 _dstChainId) internal {
        outboundNonces[_dstChainId]++;
    }
}

/**
 * @title MockFeeManagerExtensions
 * @dev Extensions for FeeManager testing
 */
abstract contract MockFeeManagerExtensions is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    address public feeCollector;
    
    event FeeCollectorSet(address indexed collector);
    
    /**
     * @dev Set the fee collector address
     */
    function setFeeCollector(address _collector) external onlyRole(ADMIN_ROLE) {
        require(_collector != address(0), "Invalid collector");
        feeCollector = _collector;
        emit FeeCollectorSet(_collector);
    }
}

/**
 * @title MockAttackerExtensions
 * @dev Attack contract extensions for security testing
 */
contract MockAttackerExtensions {
    address public target;
    uint256 public attackCounter;
    
    event AdvancedAttackExecuted(uint256 attackType, bool success);
    
    constructor(address _target) {
        target = _target;
    }
    
    /**
     * @dev Execute an advanced attack pattern
     */
    function advancedAttack(uint256 _attackType) external returns (bool success) {
        attackCounter++;
        
        // Simulate different attack patterns
        if (_attackType == 1) {
            // Reentrancy attempt
            (success,) = target.call{value: 0}(abi.encodeWithSignature("withdraw()"));
        } else if (_attackType == 2) {
            // Overflow attempt
            (success,) = target.call(abi.encodeWithSignature("transfer(address,uint256)", address(this), type(uint256).max));
        } else if (_attackType == 3) {
            // Access control bypass attempt
            (success,) = target.call(abi.encodeWithSignature("pause()"));
        }
        
        emit AdvancedAttackExecuted(_attackType, success);
    }
}

/**
 * @title MockMEVExtractor
 * @dev MEV bot simulation for testing
 */
contract MockMEVExtractor {
    mapping(address => uint256) public botFunds;
    
    event BotFunded(address bot, uint256 amount);
    
    /**
     * @dev Fund a bot for MEV extraction
     */
    function fundBot(address _bot) external payable {
        botFunds[_bot] += msg.value;
        emit BotFunded(_bot, msg.value);
    }
}