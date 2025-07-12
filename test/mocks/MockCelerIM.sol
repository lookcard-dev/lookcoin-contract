// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockMessageBus
 * @dev Mock Celer MessageBus for testing
 */
contract MockMessageBus {
    struct Message {
        address sender;
        address receiver;
        uint64 srcChainId;
        uint64 dstChainId;
        bytes message;
        uint256 fee;
        uint64 nonce;
        uint256 maxSlippage;
    }

    uint64 public currentChainId = 56; // Default BSC
    uint256 public baseFee = 0.01 ether;
    uint256 public feePerByte = 0.00001 ether;
    
    mapping(bytes32 => Message) public messages;
    mapping(address => uint64) public nonces;
    mapping(bytes32 => bool) public executedMessages;
    
    // SGN mock
    mapping(bytes32 => uint256) public sgnSignatures;
    uint256 public requiredSgnSignatures = 2;
    
    event MessageSent(
        address indexed sender,
        address receiver,
        uint64 dstChainId,
        bytes message,
        uint256 fee
    );
    
    event MessageReceived(
        address sender,
        uint64 srcChainId,
        address executor,
        uint64 dstChainId,
        bytes message
    );
    
    event MessageWithTransferSent(
        address indexed sender,
        address receiver,
        uint64 dstChainId,
        address token,
        uint256 amount,
        uint64 nonce,
        uint256 maxSlippage,
        bytes message,
        uint8 transferType
    );
    
    event Executed(
        uint8 msgType,
        bytes32 msgId,
        uint8 status,
        address indexed receiver,
        uint64 srcChainId,
        bytes32 srcTxHash
    );

    constructor() {}

    /**
     * @dev Send message
     */
    function sendMessage(
        address _receiver,
        uint64 _dstChainId,
        bytes calldata _message
    ) external payable {
        uint256 fee = calcFee(_message);
        require(msg.value >= fee, "MockMessageBus: insufficient fee");
        
        bytes32 messageId = keccak256(
            abi.encodePacked(msg.sender, _receiver, _dstChainId, nonces[msg.sender]++)
        );
        
        messages[messageId] = Message({
            sender: msg.sender,
            receiver: _receiver,
            srcChainId: currentChainId,
            dstChainId: _dstChainId,
            message: _message,
            fee: fee,
            nonce: nonces[msg.sender] - 1,
            maxSlippage: 0
        });
        
        emit MessageSent(msg.sender, _receiver, _dstChainId, _message, fee);
        
        // Refund excess fee
        if (msg.value > fee) {
            payable(msg.sender).transfer(msg.value - fee);
        }
    }

    /**
     * @dev Send message with transfer
     */
    function sendMessageWithTransfer(
        address _receiver,
        uint64 _dstChainId,
        address _token,
        uint256 _amount,
        uint64 _nonce,
        uint256 _maxSlippage,
        bytes calldata _message,
        uint8 _transferType
    ) external payable {
        uint256 fee = calcFee(_message);
        require(msg.value >= fee, "MockMessageBus: insufficient fee");
        
        emit MessageWithTransferSent(
            msg.sender,
            _receiver,
            _dstChainId,
            _token,
            _amount,
            _nonce,
            _maxSlippage,
            _message,
            _transferType
        );
    }

    /**
     * @dev Execute message (mock delivery)
     */
    function executeMessage(
        bytes32 _messageId,
        address _executor
    ) external {
        Message memory message = messages[_messageId];
        require(message.sender != address(0), "MockMessageBus: message not found");
        require(!executedMessages[_messageId], "MockMessageBus: already executed");
        
        executedMessages[_messageId] = true;
        
        // Call receiver
        (bool success, ) = message.receiver.call(
            abi.encodeWithSignature(
                "executeMessage(address,uint64,bytes,address)",
                message.sender,
                message.srcChainId,
                message.message,
                _executor
            )
        );
        
        uint8 status = success ? 1 : 2; // 1 = success, 2 = fail
        
        emit Executed(
            1, // message type
            _messageId,
            status,
            message.receiver,
            message.srcChainId,
            bytes32(0)
        );
        
        if (success) {
            emit MessageReceived(
                message.sender,
                message.srcChainId,
                _executor,
                message.dstChainId,
                message.message
            );
        }
    }

    /**
     * @dev Calculate fee
     */
    function calcFee(bytes calldata _message) public view returns (uint256) {
        return baseFee + (_message.length * feePerByte);
    }

    /**
     * @dev Set fees
     */
    function setFees(uint256 _baseFee, uint256 _feePerByte) external {
        baseFee = _baseFee;
        feePerByte = _feePerByte;
    }

    /**
     * @dev Set current chain ID
     */
    function setChainId(uint64 _chainId) external {
        currentChainId = _chainId;
    }

    /**
     * @dev Submit SGN signature
     */
    function submitSgnSignature(bytes32 _messageId) external {
        sgnSignatures[_messageId]++;
    }

    /**
     * @dev Check if message has enough signatures
     */
    function hasEnoughSignatures(bytes32 _messageId) external view returns (bool) {
        return sgnSignatures[_messageId] >= requiredSgnSignatures;
    }
}

/**
 * @title MockSGN
 * @dev Mock State Guardian Network for testing
 */
contract MockSGN {
    struct Validator {
        address addr;
        uint256 power;
        bool active;
    }
    
    mapping(address => bool) public validators;
    mapping(bytes32 => mapping(address => bool)) public signatures;
    mapping(bytes32 => uint256) public signatureCount;
    
    uint256 public totalValidators;
    uint256 public requiredSignatures;
    
    event SignatureSubmitted(bytes32 indexed messageHash, address indexed validator);
    event ConsensusReached(bytes32 indexed messageHash);
    
    constructor(uint256 _requiredSignatures) {
        requiredSignatures = _requiredSignatures;
    }
    
    /**
     * @dev Add validator
     */
    function addValidator(address _validator) external {
        require(!validators[_validator], "MockSGN: already validator");
        validators[_validator] = true;
        totalValidators++;
    }
    
    /**
     * @dev Submit signature
     */
    function submitSignature(bytes32 _messageHash) external {
        require(validators[msg.sender], "MockSGN: not validator");
        require(!signatures[_messageHash][msg.sender], "MockSGN: already signed");
        
        signatures[_messageHash][msg.sender] = true;
        signatureCount[_messageHash]++;
        
        emit SignatureSubmitted(_messageHash, msg.sender);
        
        if (signatureCount[_messageHash] >= requiredSignatures) {
            emit ConsensusReached(_messageHash);
        }
    }
    
    /**
     * @dev Verify consensus
     */
    function verifyConsensus(bytes32 _messageHash) external view returns (bool) {
        return signatureCount[_messageHash] >= requiredSignatures;
    }
    
    /**
     * @dev Set required signatures
     */
    function setRequiredSignatures(uint256 _required) external {
        require(_required > 0 && _required <= totalValidators, "MockSGN: invalid requirement");
        requiredSignatures = _required;
    }
}

/**
 * @title MockcBridge
 * @dev Mock cBridge for testing liquidity pool interactions
 */
contract MockcBridge {
    mapping(address => mapping(address => uint256)) public liquidity; // token => provider => amount
    mapping(address => uint256) public totalLiquidity;
    
    uint256 public slippageTolerance = 100; // 1% in basis points
    uint256 public bridgeFee = 50; // 0.5% in basis points
    
    event LiquidityAdded(address indexed token, address indexed provider, uint256 amount);
    event LiquidityRemoved(address indexed token, address indexed provider, uint256 amount);
    event SlippageUpdated(uint256 newSlippage);
    
    /**
     * @dev Add liquidity
     */
    function addLiquidity(address _token, uint256 _amount) external {
        liquidity[_token][msg.sender] += _amount;
        totalLiquidity[_token] += _amount;
        emit LiquidityAdded(_token, msg.sender, _amount);
    }
    
    /**
     * @dev Remove liquidity
     */
    function removeLiquidity(address _token, uint256 _amount) external {
        require(liquidity[_token][msg.sender] >= _amount, "MockcBridge: insufficient liquidity");
        liquidity[_token][msg.sender] -= _amount;
        totalLiquidity[_token] -= _amount;
        emit LiquidityRemoved(_token, msg.sender, _amount);
    }
    
    /**
     * @dev Get available liquidity
     */
    function getAvailableLiquidity(address _token) external view returns (uint256) {
        return totalLiquidity[_token];
    }
    
    /**
     * @dev Calculate slippage
     */
    function calculateSlippage(address _token, uint256 _amount) external view returns (uint256) {
        if (totalLiquidity[_token] == 0) return type(uint256).max;
        
        // Simple slippage model: increases with amount relative to pool size
        uint256 impactBps = (_amount * 10000) / totalLiquidity[_token];
        return (impactBps * slippageTolerance) / 10000;
    }
    
    /**
     * @dev Calculate bridge fee
     */
    function calculateBridgeFee(uint256 _amount) external view returns (uint256) {
        return (_amount * bridgeFee) / 10000;
    }
    
    /**
     * @dev Set slippage tolerance
     */
    function setSlippageTolerance(uint256 _tolerance) external {
        require(_tolerance <= 1000, "MockcBridge: tolerance too high"); // Max 10%
        slippageTolerance = _tolerance;
        emit SlippageUpdated(_tolerance);
    }
    
    /**
     * @dev Set bridge fee
     */
    function setBridgeFee(uint256 _fee) external {
        require(_fee <= 500, "MockcBridge: fee too high"); // Max 5%
        bridgeFee = _fee;
    }
}