// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockHyperlaneMailbox {
    mapping(address => bool) public authorizedCallers;
    bytes32 public constant MESSAGE_VERSION = bytes32(uint256(1));
    uint32 public localDomain = 56; // BSC by default
    
    // State variables for improved testing
    mapping(uint32 => uint256) public domainNonces;
    mapping(bytes32 => bool) public deliveredMessages;
    mapping(uint32 => address) public defaultIsm;
    
    // Edge case testing variables
    bool public batchCorruption;
    bool public orderManipulation;
    bool public incompatibleInterface;
    address public maliciousRecipient;
    address public interchainSecurityModule;
    bool public deliveryPaused;
    
    event MessageDelivered(bytes32 indexed messageId, uint32 origin, address recipient);
    event DeliveryStatusChanged(bool paused);
    
    event Dispatch(
        address indexed sender,
        uint32 indexed destinationDomain,
        bytes32 indexed recipientAddress,
        bytes message
    );
    
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32) {
        require(!deliveryPaused, "Dispatch paused");
        
        // Increment nonce for destination domain
        domainNonces[destinationDomain]++;
        
        bytes32 messageId = keccak256(abi.encodePacked(
            MESSAGE_VERSION,
            domainNonces[destinationDomain],
            localDomain,
            msg.sender,
            destinationDomain,
            recipientAddress,
            messageBody
        ));
        
        emit Dispatch(msg.sender, destinationDomain, recipientAddress, messageBody);
        return messageId;
    }
    
    // Enhanced dispatch with proper message formatting
    function dispatchWithMetadata(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody,
        bytes calldata metadata
    ) external payable returns (bytes32) {
        require(!deliveryPaused, "Dispatch paused");
        
        bytes32 messageId = this.dispatch(destinationDomain, recipientAddress, messageBody);
        
        // Process metadata if needed
        if (metadata.length > 0) {
            // Could implement metadata processing here
        }
        
        return messageId;
    }
    
    function deliverMessage(
        address recipient,
        uint32 origin,
        bytes32 sender,
        bytes calldata message
    ) external {
        require(authorizedCallers[msg.sender] || msg.sender == address(this), "Unauthorized");
        require(!deliveryPaused, "Delivery paused");
        
        bytes32 messageId = keccak256(abi.encodePacked(origin, sender, message));
        require(!deliveredMessages[messageId], "Message already delivered");
        
        deliveredMessages[messageId] = true;
        
        // Call the recipient's handle function
        (bool success, ) = recipient.call(
            abi.encodeWithSignature(
                "handle(uint32,bytes32,bytes)",
                origin,
                sender,
                message
            )
        );
        require(success, "Message delivery failed");
        
        emit MessageDelivered(messageId, origin, recipient);
    }
    
    // Batch message delivery
    function deliverMessages(
        address[] calldata recipients,
        uint32[] calldata origins,
        bytes32[] calldata senders,
        bytes[] calldata messages
    ) external {
        require(
            recipients.length == origins.length &&
            origins.length == senders.length &&
            senders.length == messages.length,
            "Array length mismatch"
        );
        
        for (uint256 i = 0; i < recipients.length; i++) {
            this.deliverMessage(recipients[i], origins[i], senders[i], messages[i]);
        }
    }
    
    function setAuthorizedCaller(address caller, bool authorized) external {
        authorizedCallers[caller] = authorized;
    }
    
    // Enhanced simulation methods for testing
    mapping(bytes32 => bool) public processedMessages;
    
    function simulateReceive(
        address _target,
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _message
    ) external {
        require(_target != address(0), "Invalid target");
        require(!deliveryPaused, "Delivery paused");
        
        bytes32 messageId = keccak256(abi.encodePacked(_origin, _sender, _message));
        require(!processedMessages[messageId], "Hyperlane: message already processed");
        
        processedMessages[messageId] = true;
        deliveredMessages[messageId] = true;
        
        // Increment domain nonce
        domainNonces[_origin]++;
        
        // Call handle on the target
        (bool success,) = _target.call(
            abi.encodeWithSignature(
                "handle(uint32,bytes32,bytes)",
                _origin,
                _sender,
                _message
            )
        );
        
        require(success, "handle call failed");
        emit MessageDelivered(messageId, _origin, _target);
    }
    
    // Get nonce for domain
    function getNonce(uint32 _domain) external view returns (uint256) {
        return domainNonces[_domain];
    }
    
    // Set default ISM for domain
    function setDefaultIsm(uint32 _domain, address _ism) external {
        defaultIsm[_domain] = _ism;
    }
    
    // Pause/unpause delivery
    function setDeliveryPaused(bool _paused) external {
        deliveryPaused = _paused;
        emit DeliveryStatusChanged(_paused);
    }
    
    function isMessageProcessed(bytes32 messageId) external view returns (bool) {
        return processedMessages[messageId];
    }
    
    // Edge case testing methods
    function setBatchCorruption(bool _corrupt) external {
        batchCorruption = _corrupt;
    }
    
    function setOrderManipulation(bool _manipulate) external {
        orderManipulation = _manipulate;
    }
    
    function setIncompatibleInterface(bool _incompatible) external {
        incompatibleInterface = _incompatible;
    }
    
    function setMaliciousRecipient(address _recipient) external {
        maliciousRecipient = _recipient;
    }
    
    function setInterchainSecurityModule(address _ism) external {
        interchainSecurityModule = _ism;
    }
    
    // Message verification
    function isMessageDelivered(bytes32 _messageId) external view returns (bool) {
        return deliveredMessages[_messageId];
    }
    
    // Domain management
    function setLocalDomain(uint32 _domain) external {
        localDomain = _domain;
    }
}

contract MockHyperlaneGasPaymaster {
    mapping(uint32 => uint256) public gasPrice;
    
    // Edge case testing variables
    bool public requirePayment;
    bool public acceptAlternativeTokens;
    bool public maliciousGasEstimate;
    uint256 public minimumGasPayment;
    uint256 public estimateMultiplier = 1;
    
    event GasPayment(
        bytes32 indexed messageId,
        uint256 gasAmount,
        uint256 payment
    );
    
    function payForGas(
        bytes32 messageId,
        uint32 destinationDomain,
        uint256 gasAmount,
        address refundAddress
    ) external payable {
        uint256 requiredPayment = gasAmount * gasPrice[destinationDomain] / 1e18;
        require(msg.value >= requiredPayment, "Insufficient payment");
        
        emit GasPayment(messageId, gasAmount, msg.value);
        
        // Refund excess
        if (msg.value > requiredPayment) {
            payable(refundAddress).transfer(msg.value - requiredPayment);
        }
    }
    
    function quoteGasPayment(
        uint32 destinationDomain,
        uint256 gasAmount
    ) external view returns (uint256) {
        return gasAmount * gasPrice[destinationDomain] / 1e18;
    }
    
    function setGasPrice(uint32 domain, uint256 price) external {
        gasPrice[domain] = price;
    }
    
    // Edge case testing methods
    function setRequirePayment(bool _require) external {
        requirePayment = _require;
    }
    
    function setMinimumGasPayment(uint256 _minimum) external {
        minimumGasPayment = _minimum;
    }
    
    function setAcceptAlternativeTokens(bool _accept) external {
        acceptAlternativeTokens = _accept;
    }
    
    function setMaliciousGasEstimate(bool _malicious) external {
        maliciousGasEstimate = _malicious;
    }
    
    function setEstimateMultiplier(uint256 _multiplier) external {
        estimateMultiplier = _multiplier;
    }
}

contract MockInterchainSecurityModule {
    uint8 public moduleType = 1; // MULTISIG type
    uint8 public threshold = 2;
    
    // Edge case testing variables
    bool public verificationFailure;
    bool public invalidConfiguration;
    bool public alwaysVerify;
    bool public maliciousBehavior;
    bool public collusionMode;
    address[] public validators;
    address[] public colludingValidators;
    bytes[] public maliciousSignatures;
    
    function verify(
        bytes calldata metadata,
        bytes calldata message
    ) external view returns (bool) {
        if (verificationFailure) return false;
        if (alwaysVerify) return true;
        if (maliciousBehavior) revert("Malicious ISM behavior");
        if (collusionMode) {
            // Check if enough validators are colluding
            if (colludingValidators.length >= threshold) {
                revert("ValidatorCollusionDetected");
            }
        }
        return true;
    }
    
    function verifyMessageId(
        bytes32 messageId,
        bytes calldata metadata
    ) external view returns (bool) {
        return true; // Mock implementation always returns true
    }
    
    // Edge case testing methods
    function setVerificationFailure(bool _fail) external {
        verificationFailure = _fail;
    }
    
    function setInvalidConfiguration(bool _invalid) external {
        invalidConfiguration = _invalid;
    }
    
    function setAlwaysVerify(bool _always) external {
        alwaysVerify = _always;
    }
    
    function setMaliciousBehavior(bool _malicious) external {
        maliciousBehavior = _malicious;
    }
    
    function setCollusionMode(bool _collusion) external {
        collusionMode = _collusion;
    }
    
    function setValidators(address[] calldata _validators) external {
        // Clear existing validators
        delete validators;
        // Copy validators one by one
        for (uint256 i = 0; i < _validators.length; i++) {
            validators.push(_validators[i]);
        }
    }
    
    function setColludingValidators(address[] calldata _colluding) external {
        // Clear existing colluding validators
        delete colludingValidators;
        // Copy colluding validators one by one
        for (uint256 i = 0; i < _colluding.length; i++) {
            colludingValidators.push(_colluding[i]);
        }
    }
    
    function setMaliciousSignatures(bytes[] calldata _signatures) external {
        // Clear existing signatures
        delete maliciousSignatures;
        // Copy signatures one by one
        for (uint256 i = 0; i < _signatures.length; i++) {
            maliciousSignatures.push(_signatures[i]);
        }
    }
    
    function setThreshold(uint8 _threshold) external {
        require(_threshold > 0 && _threshold <= validators.length, "InvalidThreshold");
        threshold = _threshold;
    }
    
    function rotateValidators(address[] calldata _newValidators) external {
        // Clear existing validators
        delete validators;
        // Copy new validators one by one
        for (uint256 i = 0; i < _newValidators.length; i++) {
            validators.push(_newValidators[i]);
        }
    }
    
    function validatorCount() external view returns (uint256) {
        return validators.length;
    }
}