// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@layerzerolabs/oft-evm/contracts/oft/v2/interfaces/IOFTV2.sol";

/**
 * @title MockLayerZeroEndpoint
 * @dev Mock LayerZero endpoint for testing
 */
contract MockLayerZeroEndpoint {
    struct StoredPayload {
        uint64 payloadLength;
        address dstAddress;
        bytes32 payloadHash;
    }

    struct QueuedPayload {
        address dstAddress;
        uint64 nonce;
        bytes payload;
    }

    // Inbound
    uint16 public mockChainId;
    mapping(address => mapping(uint16 => mapping(bytes => mapping(uint64 => bytes32)))) public storedPayloads;
    mapping(address => mapping(uint16 => mapping(bytes => uint64))) public inboundNonce;
    
    // Outbound
    mapping(address => mapping(uint16 => mapping(bytes => uint64))) public outboundNonce;
    mapping(address => address) public lzEndpointLookup;
    mapping(uint16 => mapping(bytes => mapping(uint64 => QueuedPayload[]))) public msgsToDeliver;

    // DVN mock
    mapping(uint16 => address[]) public dvnAddresses;
    mapping(uint16 => uint256) public dvnThreshold;
    uint256 public dvnValidationDelay = 0; // Instant for testing
    
    // Fee calculation
    uint256 public mockEstimateFees = 0.1 ether;
    uint256 public mockLayerZeroFee = 0.05 ether;

    // Events
    event PayloadCleared(uint16 srcChainId, bytes srcAddress, uint64 nonce, address dstAddress);
    event PayloadStored(uint16 srcChainId, bytes srcAddress, address dstAddress, uint64 nonce, bytes payload, bytes reason);
    event ValueTransferFailed(address indexed to, uint indexed quantity);
    event LzReceive(uint16 indexed srcChainId, bytes srcAddress, address indexed dstAddress, uint64 nonce, bytes payload);
    event LzSend(uint16 indexed dstChainId, bytes indexed dstAddress, bytes payload);

    constructor(uint16 _chainId) {
        mockChainId = _chainId;
    }

    /**
     * @dev Mock send function
     */
    function send(
        uint16 _dstChainId,
        bytes calldata _destination,
        bytes calldata _payload,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable {
        address userApplication = msg.sender;
        uint64 nonce = ++outboundNonce[userApplication][_dstChainId][_destination];

        // Store message to deliver
        msgsToDeliver[_dstChainId][_destination][nonce].push(QueuedPayload({
            dstAddress: userApplication,
            nonce: nonce,
            payload: _payload
        }));

        emit LzSend(_dstChainId, _destination, _payload);

        // Refund excess fees
        uint256 messageFee = estimateFees(_dstChainId, userApplication, _payload, false, _adapterParams);
        require(msg.value >= messageFee, "LayerZero: insufficient fees");
        
        if (msg.value > messageFee && _refundAddress != address(0)) {
            uint256 refund = msg.value - messageFee;
            (bool success, ) = _refundAddress.call{value: refund}("");
            if (!success) {
                emit ValueTransferFailed(_refundAddress, refund);
            }
        }
    }

    /**
     * @dev Mock receive function
     */
    function receivePayload(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        address _dstAddress,
        uint64 _nonce,
        uint _gasLimit,
        bytes calldata _payload
    ) external {
        StoredPayload storage sp = storedPayloads[_dstAddress][_srcChainId][_srcAddress][_nonce];
        require(sp.payloadHash == bytes32(0), "LayerZero: payload already received");

        // Simulate DVN validation delay
        if (dvnValidationDelay > 0) {
            sp.payloadLength = uint64(_payload.length);
            sp.dstAddress = _dstAddress;
            sp.payloadHash = keccak256(_payload);
            emit PayloadStored(_srcChainId, _srcAddress, _dstAddress, _nonce, _payload, bytes(""));
            return;
        }

        // Direct delivery
        inboundNonce[_dstAddress][_srcChainId][_srcAddress] = _nonce;
        
        try ILayerZeroReceiver(_dstAddress).lzReceive{gas: _gasLimit}(_srcChainId, _srcAddress, _nonce, _payload) {
            emit LzReceive(_srcChainId, _srcAddress, _dstAddress, _nonce, _payload);
        } catch (bytes memory reason) {
            sp.payloadLength = uint64(_payload.length);
            sp.dstAddress = _dstAddress;
            sp.payloadHash = keccak256(_payload);
            emit PayloadStored(_srcChainId, _srcAddress, _dstAddress, _nonce, _payload, reason);
        }
    }

    /**
     * @dev Mock estimate fees
     */
    function estimateFees(
        uint16 _dstChainId,
        address _userApplication,
        bytes calldata _payload,
        bool _payInZRO,
        bytes calldata _adapterParam
    ) public view returns (uint nativeFee, uint zroFee) {
        nativeFee = mockEstimateFees;
        zroFee = _payInZRO ? mockLayerZeroFee : 0;
    }

    /**
     * @dev Set mock chain ID
     */
    function setMockChainId(uint16 _chainId) external {
        mockChainId = _chainId;
    }

    /**
     * @dev Set mock fees
     */
    function setMockFees(uint256 _estimateFees, uint256 _layerZeroFee) external {
        mockEstimateFees = _estimateFees;
        mockLayerZeroFee = _layerZeroFee;
    }

    /**
     * @dev Configure DVN for testing
     */
    function configureDVN(uint16 _chainId, address[] calldata _dvnAddresses, uint256 _threshold) external {
        dvnAddresses[_chainId] = _dvnAddresses;
        dvnThreshold[_chainId] = _threshold;
    }

    /**
     * @dev Set DVN validation delay
     */
    function setDVNValidationDelay(uint256 _delay) external {
        dvnValidationDelay = _delay;
    }

    /**
     * @dev Deliver queued messages
     */
    function deliverMessages(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        uint64 _nonce
    ) external {
        QueuedPayload[] storage queued = msgsToDeliver[_srcChainId][_srcAddress][_nonce];
        require(queued.length > 0, "No messages to deliver");

        for (uint i = 0; i < queued.length; i++) {
            QueuedPayload memory payload = queued[i];
            receivePayload(_srcChainId, _srcAddress, payload.dstAddress, payload.nonce, 200000, payload.payload);
        }
        
        delete msgsToDeliver[_srcChainId][_srcAddress][_nonce];
    }

    /**
     * @dev Force resume receive
     */
    function forceResumeReceive(uint16 _srcChainId, bytes calldata _srcAddress) external {
        // Mock implementation
    }

    /**
     * @dev Get inbound nonce
     */
    function getInboundNonce(uint16 _srcChainId, bytes calldata _srcAddress) external view returns (uint64) {
        return inboundNonce[msg.sender][_srcChainId][_srcAddress];
    }

    /**
     * @dev Get outbound nonce
     */
    function getOutboundNonce(uint16 _dstChainId, address _srcAddress) external view returns (uint64) {
        return outboundNonce[_srcAddress][_dstChainId][abi.encodePacked(_srcAddress)];
    }

    /**
     * @dev Set trusted remote
     */
    function setTrustedRemote(uint16 _remoteChainId, bytes calldata _path) external {
        // Mock implementation
    }

    /**
     * @dev Get config
     */
    function getConfig(
        uint16 _version,
        uint16 _chainId,
        address _userApplication,
        uint _configType
    ) external view returns (bytes memory) {
        return "";
    }

    /**
     * @dev Set config
     */
    function setConfig(
        uint16 _version,
        uint16 _chainId,
        uint _configType,
        bytes calldata _config
    ) external {
        // Mock implementation
    }
}

/**
 * @title MockDVN
 * @dev Mock Decentralized Verifier Network for testing
 */
contract MockDVN {
    struct ValidationRequest {
        uint16 srcChainId;
        uint16 dstChainId;
        bytes payload;
        uint256 timestamp;
        bool validated;
    }

    mapping(bytes32 => ValidationRequest) public validationRequests;
    mapping(bytes32 => mapping(address => bool)) public validatorSignatures;
    mapping(bytes32 => uint256) public signatureCount;

    uint256 public requiredSignatures;
    uint256 public validationTimeout = 600; // 10 minutes
    
    event ValidationRequested(bytes32 indexed requestId, uint16 srcChainId, uint16 dstChainId);
    event ValidationCompleted(bytes32 indexed requestId, bool success);

    constructor(uint256 _requiredSignatures) {
        requiredSignatures = _requiredSignatures;
    }

    /**
     * @dev Request validation
     */
    function requestValidation(
        uint16 _srcChainId,
        uint16 _dstChainId,
        bytes calldata _payload
    ) external returns (bytes32 requestId) {
        requestId = keccak256(abi.encodePacked(_srcChainId, _dstChainId, _payload, block.timestamp));
        
        validationRequests[requestId] = ValidationRequest({
            srcChainId: _srcChainId,
            dstChainId: _dstChainId,
            payload: _payload,
            timestamp: block.timestamp,
            validated: false
        });
        
        emit ValidationRequested(requestId, _srcChainId, _dstChainId);
    }

    /**
     * @dev Submit validator signature
     */
    function submitSignature(bytes32 _requestId) external {
        require(validationRequests[_requestId].timestamp > 0, "Invalid request");
        require(!validationRequests[_requestId].validated, "Already validated");
        require(!validatorSignatures[_requestId][msg.sender], "Already signed");
        
        validatorSignatures[_requestId][msg.sender] = true;
        signatureCount[_requestId]++;
        
        if (signatureCount[_requestId] >= requiredSignatures) {
            validationRequests[_requestId].validated = true;
            emit ValidationCompleted(_requestId, true);
        }
    }

    /**
     * @dev Check if validation is complete
     */
    function isValidated(bytes32 _requestId) external view returns (bool) {
        return validationRequests[_requestId].validated;
    }

    /**
     * @dev Check if validation has timed out
     */
    function isTimedOut(bytes32 _requestId) external view returns (bool) {
        ValidationRequest memory request = validationRequests[_requestId];
        return request.timestamp > 0 && 
               block.timestamp > request.timestamp + validationTimeout && 
               !request.validated;
    }
}

/**
 * @title MockUltraLightNode
 * @dev Mock UltraLightNode for testing message processing
 */
contract MockUltraLightNode {
    mapping(bytes32 => bytes) public messages;
    mapping(bytes32 => bool) public messageDelivered;

    event MessageStored(bytes32 indexed messageId, bytes message);
    event MessageDelivered(bytes32 indexed messageId);

    /**
     * @dev Store message
     */
    function storeMessage(bytes calldata _message) external returns (bytes32 messageId) {
        messageId = keccak256(_message);
        messages[messageId] = _message;
        emit MessageStored(messageId, _message);
    }

    /**
     * @dev Deliver message
     */
    function deliverMessage(bytes32 _messageId, address _target) external {
        require(messages[_messageId].length > 0, "Message not found");
        require(!messageDelivered[_messageId], "Already delivered");
        
        messageDelivered[_messageId] = true;
        
        // Decode and deliver to target
        (bool success, ) = _target.call(messages[_messageId]);
        require(success, "Delivery failed");
        
        emit MessageDelivered(_messageId);
    }

    /**
     * @dev Verify message
     */
    function verifyMessage(bytes32 _messageId) external view returns (bool) {
        return messages[_messageId].length > 0;
    }
}

interface ILayerZeroReceiver {
    function lzReceive(uint16 _srcChainId, bytes calldata _srcAddress, uint64 _nonce, bytes calldata _payload) external;
}