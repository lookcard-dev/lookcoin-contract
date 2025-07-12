// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../bridges/CelerIMModule.sol";

contract MockMessageBus {
    address public sgn;
    address public cbridge;
    uint256 public feeBase = 0.001 ether;
    uint256 public feePerByte = 1000;
    
    mapping(bytes32 => bool) public processedMessages;
    
    event MessageSent(address receiver, uint256 chainId, bytes message, bytes32 transferId, uint256 fee);
    
    function setSGN(address _sgn) external {
        sgn = _sgn;
    }
    
    function setCBridge(address _cbridge) external {
        cbridge = _cbridge;
    }
    
    function setFeeParams(uint256 _feeBase, uint256 _feePerByte) external {
        feeBase = _feeBase;
        feePerByte = _feePerByte;
    }
    
    function sendMessageWithTransfer(
        address _receiver,
        uint256 _chainId,
        bytes calldata _message,
        address _bridgeAddress,
        bytes32 _transferId,
        uint256 _fee
    ) external payable {
        require(msg.value >= _fee, "Insufficient fee");
        processedMessages[_transferId] = true;
        emit MessageSent(_receiver, _chainId, _message, _transferId, _fee);
    }
    
    function simulateIncomingMessage(
        address _receiver,
        address _sender,
        address _token,
        uint256 _amount,
        uint64 _srcChainId,
        bytes calldata _message,
        address _executor
    ) external {
        IMessageReceiverApp(_receiver).executeMessageWithTransfer(
            _sender,
            _token,
            _amount,
            _srcChainId,
            _message,
            _executor
        );
    }
}

contract MockSGN {
    mapping(bytes32 => bool) public verifiedSignatures;
    
    function verifySignature(bytes32 _hash) external {
        verifiedSignatures[_hash] = true;
    }
    
    function isVerified(bytes32 _hash) external view returns (bool) {
        return verifiedSignatures[_hash];
    }
}

contract MockCBridge {
    mapping(address => uint256) public lockedBalances;
    
    function lock(address _token, uint256 _amount) external {
        lockedBalances[_token] += _amount;
    }
    
    function unlock(address _token, uint256 _amount) external {
        require(lockedBalances[_token] >= _amount, "Insufficient locked balance");
        lockedBalances[_token] -= _amount;
    }
}