// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockTimeDelay {
    uint256 private currentTime;
    
    constructor() {
        currentTime = block.timestamp;
    }
    
    function setTime(uint256 _time) external {
        currentTime = _time;
    }
    
    function advanceTime(uint256 _seconds) external {
        currentTime += _seconds;
    }
    
    function getTime() external view returns (uint256) {
        return currentTime;
    }
}

contract MockNetworkSimulator {
    uint256 public latency;
    uint256 public packetLoss;
    uint256 public jitter;
    
    // Enhanced simulation state
    mapping(uint256 => bool) public isPartitioned;
    mapping(uint256 => bool) public hasReorg;
    mapping(bytes32 => bool) public messageFailures;
    mapping(bytes32 => bool) public messageSuccesses;
    mapping(bytes32 => bool) public prepareAcks;
    mapping(bytes32 => bool) public commits;
    mapping(uint256 => uint256) public reorgBlocks;
    
    event ConditionsSet(uint256 latency, uint256 packetLoss, uint256 jitter);
    event PacketSent(bytes32 packetId, bool dropped, uint256 delay);
    event PartitionSimulated(uint256[] chainIds);
    event PartitionResolved(uint256[] chainIds);
    event ReorgSimulated(uint256 chainId, uint256 fromBlock, uint256 toBlock);
    event ReorgResolved();
    event MessageFailureSimulated(uint256 chainId, bytes32 messageId);
    event MessageSuccessSimulated(uint256 chainId, bytes32 messageId);
    event PrepareAckSimulated(uint256 chainId, bytes32 transactionId);
    event CommitSimulated(uint256 chainId, bytes32 transactionId);
    
    function setConditions(uint256 _latency, uint256 _packetLoss, uint256 _jitter) external {
        latency = _latency;
        packetLoss = _packetLoss;
        jitter = _jitter;
        emit ConditionsSet(_latency, _packetLoss, _jitter);
    }
    
    function simulatePacket(bytes32 _packetId) external returns (bool dropped, uint256 delay) {
        // Simple simulation logic
        uint256 random = uint256(keccak256(abi.encodePacked(block.timestamp, _packetId))) % 100;
        dropped = random < packetLoss;
        
        if (!dropped) {
            // Calculate delay with jitter
            uint256 jitterValue = uint256(keccak256(abi.encodePacked(random, _packetId))) % jitter;
            delay = latency + jitterValue;
        }
        
        emit PacketSent(_packetId, dropped, delay);
        return (dropped, delay);
    }
    
    // Network partition simulation
    function simulatePartition(uint256[] memory chainIds) external {
        for (uint256 i = 0; i < chainIds.length; i++) {
            isPartitioned[chainIds[i]] = true;
        }
        emit PartitionSimulated(chainIds);
    }
    
    function resolvePartition(uint256[] memory chainIds) external {
        for (uint256 i = 0; i < chainIds.length; i++) {
            isPartitioned[chainIds[i]] = false;
        }
        emit PartitionResolved(chainIds);
    }
    
    // Chain reorganization simulation
    function simulateReorg(uint256 fromBlock, uint256 toBlock) external {
        reorgBlocks[fromBlock] = toBlock;
        hasReorg[fromBlock] = true;
        emit ReorgSimulated(0, fromBlock, toBlock); // Using 0 as default chain ID
    }
    
    function resolveReorg() external {
        emit ReorgResolved();
    }
    
    // Message failure/success simulation
    function simulateMessageFailure(uint256 chainId, bytes32 messageId) external {
        messageFailures[messageId] = true;
        emit MessageFailureSimulated(chainId, messageId);
    }
    
    function simulateMessageSuccess(uint256 chainId, bytes32 messageId) external {
        messageSuccesses[messageId] = true;
        emit MessageSuccessSimulated(chainId, messageId);
    }
    
    // Two-phase commit simulation
    function simulatePrepareAck(uint256 chainId, bytes32 transactionId) external {
        prepareAcks[transactionId] = true;
        emit PrepareAckSimulated(chainId, transactionId);
    }
    
    function simulateCommit(uint256 chainId, bytes32 transactionId) external {
        commits[transactionId] = true;
        emit CommitSimulated(chainId, transactionId);
    }
    
    // Query functions
    function isChainPartitioned(uint256 chainId) external view returns (bool) {
        return isPartitioned[chainId];
    }
    
    function hasMessageFailed(bytes32 messageId) external view returns (bool) {
        return messageFailures[messageId];
    }
    
    function hasMessageSucceeded(bytes32 messageId) external view returns (bool) {
        return messageSuccesses[messageId];
    }
    
    function hasPrepareAck(bytes32 transactionId) external view returns (bool) {
        return prepareAcks[transactionId];
    }
    
    function hasCommit(bytes32 transactionId) external view returns (bool) {
        return commits[transactionId];
    }
}

contract UUPSProxy {
    address private _implementation;
    
    constructor(address implementation_, bytes memory data_) {
        _implementation = implementation_;
        if(data_.length > 0) {
            (bool success,) = implementation_.delegatecall(data_);
            require(success);
        }
    }
    
    fallback() external payable {
        address impl = _implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
    
    receive() external payable {}
}