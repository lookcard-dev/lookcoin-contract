// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../bridges/CelerIMModule.sol";

contract MockMessageBus {
    address public sgn;
    address public cbridge;
    uint256 public feeBase = 0.001 ether;
    uint256 public feePerByte = 1000;
    
    mapping(bytes32 => bool) public processedMessages;
    mapping(uint256 => uint256) public chainNonces;
    mapping(address => bool) public authorizedSenders;
    
    bool public bridgeActive = true;
    uint256 public liquidityBuffer = 1000 ether; // Available liquidity
    
    event BridgeStatusChanged(bool active);
    event LiquidityUpdated(uint256 amount);
    event FeeParametersUpdated(uint256 feeBase, uint256 feePerByte);
    
    // Edge case testing variables
    uint256 public congestionLevel;
    uint256 public messageTimeout = 3600; // 1 hour default
    address public maliciousExecutor;
    address public selectedExecutor;
    uint256 public queueCapacity = 1000;
    uint256 public currentQueueSize;
    bool public queueFull;
    
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
        emit FeeParametersUpdated(_feeBase, _feePerByte);
    }
    
    // Get nonce for chain
    function getNonce(uint256 _chainId) external view returns (uint256) {
        return chainNonces[_chainId];
    }
    
    // Authorize sender
    function authorizeSender(address _sender, bool _authorized) external {
        authorizedSenders[_sender] = _authorized;
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
        require(bridgeActive, "Bridge is paused");
        require(_amount <= liquidityBuffer, "Insufficient liquidity");
        
        // Update liquidity
        liquidityBuffer -= _amount;
        
        IMessageReceiverApp(_receiver).executeMessageWithTransfer(
            _sender,
            _token,
            _amount,
            _srcChainId,
            _message,
            _executor
        );
    }
    
    // Calculate bridge fees with improved logic
    function calculateFee(uint256 _amount, uint256 _chainId) external view returns (uint256) {
        uint256 baseFee = feeBase;
        uint256 amountFee = (_amount * feePerByte) / 1e18;
        uint256 chainMultiplier = getChainMultiplier(_chainId);
        
        return (baseFee + amountFee) * chainMultiplier / 1e18;
    }
    
    function getChainMultiplier(uint256 _chainId) internal pure returns (uint256) {
        // Different multipliers based on chain
        if (_chainId == 1) return 15e17; // Ethereum: 1.5x
        if (_chainId == 56) return 1e18; // BSC: 1.0x
        if (_chainId == 10) return 12e17; // Optimism: 1.2x
        return 1e18; // Default: 1.0x
    }
    
    // Enhanced simulation methods for testing
    mapping(bytes32 => bool) public executedMessages;
    
    function simulateReceive(
        address _target,
        address _sender,
        uint64 _srcChainId,
        bytes32 _messageId,
        bytes calldata _message
    ) external {
        require(_target != address(0), "Invalid target");
        require(bridgeActive, "Bridge is paused");
        require(!executedMessages[_messageId], "Celer: message already executed");
        
        executedMessages[_messageId] = true;
        
        // Increment nonce for source chain
        chainNonces[_srcChainId]++;
        
        // Call executeMessage on the target
        (bool success,) = _target.call(
            abi.encodeWithSignature(
                "executeMessage(address,uint64,bytes,address)",
                _sender,
                _srcChainId,
                _message,
                address(this)
            )
        );
        
        require(success, "executeMessage call failed");
    }
    
    // Enhanced message simulation with transfer
    function simulateReceiveWithTransfer(
        address _target,
        address _sender,
        address _token,
        uint256 _amount,
        uint64 _srcChainId,
        bytes calldata _message
    ) external {
        require(_target != address(0), "Invalid target");
        require(bridgeActive, "Bridge is paused");
        require(_amount <= liquidityBuffer, "Insufficient liquidity");
        
        // Update liquidity
        liquidityBuffer -= _amount;
        chainNonces[_srcChainId]++;
        
        // Call executeMessageWithTransfer on the target
        (bool success,) = _target.call(
            abi.encodeWithSignature(
                "executeMessageWithTransfer(address,address,uint256,uint64,bytes,address)",
                _sender,
                _token,
                _amount,
                _srcChainId,
                _message,
                address(this)
            )
        );
        
        require(success, "executeMessageWithTransfer call failed");
    }
    
    function isMessageExecuted(bytes32 _messageId) external view returns (bool) {
        return executedMessages[_messageId];
    }
    
    // Bridge management
    function setBridgeStatus(bool _active) external {
        bridgeActive = _active;
        emit BridgeStatusChanged(_active);
    }
    
    function updateLiquidity(uint256 _amount) external {
        liquidityBuffer = _amount;
        emit LiquidityUpdated(_amount);
    }
    
    function addLiquidity(uint256 _amount) external {
        liquidityBuffer += _amount;
        emit LiquidityUpdated(liquidityBuffer);
    }
    
    function removeLiquidity(uint256 _amount) external {
        require(_amount <= liquidityBuffer, "Insufficient liquidity");
        liquidityBuffer -= _amount;
        emit LiquidityUpdated(liquidityBuffer);
    }
    
    // Edge case testing methods
    function setCongestionLevel(uint256 _level) external {
        congestionLevel = _level;
        // Adjust fees based on congestion
        if (_level > 50) {
            feeBase = feeBase * 2; // Double fees during high congestion
        }
    }
    
    function setBaseFee(uint256 _fee) external {
        feeBase = _fee;
        emit FeeParametersUpdated(_fee, feePerByte);
    }
    
    function setMessageTimeout(uint256 _timeout) external {
        messageTimeout = _timeout;
    }
    
    function setMaliciousExecutor(address _executor) external {
        maliciousExecutor = _executor;
        selectedExecutor = _executor;
    }
    
    function setQueueCapacity(uint256 _capacity) external {
        queueCapacity = _capacity;
    }
    
    function simulateQueueFull() external {
        currentQueueSize = queueCapacity;
        queueFull = true;
    }
    
    function resetQueue() external {
        currentQueueSize = 0;
        queueFull = false;
    }
}

contract MockSGN {
    mapping(bytes32 => bool) public verifiedSignatures;
    bool public invalidSignatureMode;
    
    function verifySignature(bytes32 _hash) external {
        if (invalidSignatureMode) {
            revert("InvalidExecutorSignature");
        }
        verifiedSignatures[_hash] = true;
    }
    
    function isVerified(bytes32 _hash) external view returns (bool) {
        return verifiedSignatures[_hash];
    }
    
    function setInvalidSignatureMode(bool _invalid) external {
        invalidSignatureMode = _invalid;
    }
}

contract MockCBridge {
    mapping(address => uint256) public lockedBalances;
    mapping(uint256 => uint256) public chainPriceDiscrepancy;
    
    // Edge case testing variables
    bool public maliciousPriceFeed;
    bool public priceFeedManipulation;
    bool public maliciousExchangeRate;
    uint256 public slippageMultiplier = 1 ether; // 1x by default
    uint256 public manipulatedRate = 1 ether; // 1:1 by default
    
    function lock(address _token, uint256 _amount) external {
        lockedBalances[_token] += _amount;
    }
    
    function unlock(address _token, uint256 _amount) external {
        require(lockedBalances[_token] >= _amount, "Insufficient locked balance");
        lockedBalances[_token] -= _amount;
    }
    
    // Edge case testing methods
    function setMaliciousPriceFeed(bool _malicious) external {
        maliciousPriceFeed = _malicious;
    }
    
    function setSlippageMultiplier(uint256 _multiplier) external {
        slippageMultiplier = _multiplier;
    }
    
    function setPriceFeedManipulation(bool _manipulated) external {
        priceFeedManipulation = _manipulated;
    }
    
    function setManipulatedRate(uint256 _rate) external {
        manipulatedRate = _rate;
    }
    
    function setMaliciousExchangeRate(bool _malicious) external {
        maliciousExchangeRate = _malicious;
    }
    
    function setChainPriceDiscrepancy(uint256 _chainId, uint256 _price) external {
        chainPriceDiscrepancy[_chainId] = _price;
    }
}