// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockIBCRelayer {
    uint256 public packetTimeout;
    uint256 public unbondingPeriod;
    mapping(bytes32 => bool) public processedPackets;
    
    event PacketRelayed(bytes32 packetId, uint64 sequence);
    event TimeoutSet(uint256 timeout, uint256 unbonding);
    
    function setTimeoutParams(uint256 _timeout, uint256 _unbonding) external {
        packetTimeout = _timeout;
        unbondingPeriod = _unbonding;
        emit TimeoutSet(_timeout, _unbonding);
    }
    
    function relayPacket(bytes32 _packetId, uint64 _sequence) external {
        processedPackets[_packetId] = true;
        emit PacketRelayed(_packetId, _sequence);
    }
    
    function isProcessed(bytes32 _packetId) external view returns (bool) {
        return processedPackets[_packetId];
    }
}

contract MockAkashicValidators {
    address[] public validators;
    mapping(address => bool) public isValidator;
    
    event ValidatorsSet(address[] validators);
    
    function setValidators(address[] calldata _validators) external {
        // Clear old validators
        for (uint i = 0; i < validators.length; i++) {
            isValidator[validators[i]] = false;
        }
        
        // Set new validators
        validators = _validators;
        for (uint i = 0; i < _validators.length; i++) {
            isValidator[_validators[i]] = true;
        }
        
        emit ValidatorsSet(_validators);
    }
    
    function getValidatorCount() external view returns (uint256) {
        return validators.length;
    }
    
    function checkValidator(address _validator) external view returns (bool) {
        return isValidator[_validator];
    }
}

contract MockIBCLightClient {
    struct Header {
        uint256 height;
        uint256 timestamp;
        bytes32 appHash;
    }
    
    mapping(uint256 => Header) public headers;
    uint256 public latestHeight;
    
    function updateHeader(uint256 _height, uint256 _timestamp, bytes32 _appHash) external {
        headers[_height] = Header(_height, _timestamp, _appHash);
        if (_height > latestHeight) {
            latestHeight = _height;
        }
    }
    
    function verifyMembership(
        uint256 _height,
        bytes calldata _proof,
        bytes calldata _path,
        bytes calldata _value
    ) external view returns (bool) {
        // Simplified verification for testing
        return headers[_height].timestamp > 0;
    }
}