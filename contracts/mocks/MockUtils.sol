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
    
    event ConditionsSet(uint256 latency, uint256 packetLoss, uint256 jitter);
    event PacketSent(bytes32 packetId, bool dropped, uint256 delay);
    
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